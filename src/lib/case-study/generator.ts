import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AiClient } from "@/lib/ai/client";
import { normalizeAnswer, sanitizeForModel } from "@/lib/ai/sanitize";
import { redactUnverified, verifyContent, type ClaimRef, type Issue } from "./claim-check";
import { DRAFTING_SYSTEM, EXTRACTION_SYSTEM, extractJson, feedbackMessage } from "./prompts";
import { caseStudyContentSchema, type CaseStudyContent } from "./schema";

// Three steps, each checked in code rather than trusted:
//   1. EXTRACT  what the client said (claims), then keep only claims whose quote really is
//               word for word in the message they cite.
//   2. DRAFT    from the verified claims and the client's answers only.
//   3. VERIFY   every number and quote in the draft against the claims; retry once; if it
//               still fails, whatever cannot be verified is removed before saving, so a
//               fabricated figure can never be stored.

export type GenerateError = "not_found" | "not_complete" | "exists" | "no_claims" | "ai_failed" | "forbidden" | "failed";
export type GenerateResult =
  | { ok: true; caseStudyId: string; issues: Issue[]; claimCount: number }
  | { ok: false; error: GenerateError };

export interface GeneratorDeps {
  /** The signed-in user's client: every read and write runs under their row-level security. */
  supabase: SupabaseClient;
  ai: AiClient;
}

const MAX_CLAIMS = 30;
const EXTRACTION_TOKENS = 2000;
const DRAFT_TOKENS = 3000;

const extractionSchema = z.object({
  claims: z
    .array(
      z.object({
        messageRef: z.string().max(10),
        quote: z.string().min(3).max(500),
        text: z.string().min(1).max(500),
        kind: z.enum(["metric", "timeframe", "quote", "fact"]),
      }),
    )
    .max(100),
});

interface ClientMessage {
  alias: string;
  id: string;
  content: string;
}

interface VerifiedClaim {
  alias: string;
  uuid: string;
  text: string;
  kind: string;
  messageId: string;
  messageContent: string;
  quote: string;
}

const stripAngle = (value: string) => value.replace(/[<>]/g, "").trim();

async function ask(ai: AiClient, system: string, content: string, maxTokens: number): Promise<string | null> {
  try {
    const result = await ai.complete({ system, messages: [{ role: "user", content }], maxTokens });
    return result.text;
  } catch {
    return null;
  }
}

function transcriptText(rows: Array<{ role: string; content: string }>, clientMessages: ClientMessage[]): string {
  let clientIndex = 0;
  return rows
    .map((row) => {
      if (row.role !== "client") return `interviewer: ${row.content}`;
      const alias = clientMessages[clientIndex++]?.alias ?? "m?";
      return `[${alias}] client: ${sanitizeForModel(row.content)}`;
    })
    .join("\n");
}

function verifyClaims(raw: unknown, messages: ClientMessage[]): VerifiedClaim[] {
  const parsed = extractionSchema.safeParse(raw);
  if (!parsed.success) return [];
  const byAlias = new Map(messages.map((m) => [m.alias, m] as const));
  const seen = new Set<string>();
  const out: VerifiedClaim[] = [];

  for (const claim of parsed.data.claims) {
    const message = byAlias.get(claim.messageRef);
    // Keep a claim only if the quote is word for word in the client message it cites.
    if (!message || !message.content.includes(claim.quote)) continue;
    const key = `${message.id}|${claim.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      alias: `c${out.length + 1}`,
      uuid: randomUUID(),
      text: stripAngle(claim.text).slice(0, 500) || claim.quote,
      kind: claim.kind,
      messageId: message.id,
      messageContent: message.content,
      quote: claim.quote,
    });
    if (out.length >= MAX_CLAIMS) break;
  }
  return out;
}

/** Name shown on the page, as the client allowed. The model never chooses it. */
export function clientIdentity(permission: string | null, fullName: string): { name?: string; attribution: string } {
  const name = stripAngle(fullName);
  if (permission === "full" && name) return { name: name.slice(0, 120), attribution: name.slice(0, 120) };
  if (permission === "first_name" && name) {
    const first = name.split(/\s+/)[0].slice(0, 120);
    return { name: first, attribution: first };
  }
  return { attribution: "A customer" };
}

async function draftOnce(ai: AiClient, prompt: string): Promise<CaseStudyContent | null> {
  const text = await ask(ai, DRAFTING_SYSTEM, prompt, DRAFT_TOKENS);
  if (text === null) return null;
  const parsed = caseStudyContentSchema.safeParse(extractJson(text));
  return parsed.success ? parsed.data : null;
}

export async function generateCaseStudy(
  deps: GeneratorDeps,
  { workspaceId, interviewId }: { workspaceId: string; interviewId: string },
): Promise<GenerateResult> {
  const { supabase, ai } = deps;

  // Row-level security makes another workspace's interview simply "not found".
  const { data: interview } = await supabase
    .from("interviews")
    .select("id, request_id, status, consent_given, publish_permission")
    .eq("id", interviewId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!interview) return { ok: false, error: "not_found" };
  if (interview.status !== "completed" || interview.consent_given !== true) return { ok: false, error: "not_complete" };

  const [messagesResult, requestResult] = await Promise.all([
    supabase.from("interview_messages").select("id, role, content").eq("interview_id", interviewId).eq("workspace_id", workspaceId).order("created_at").order("id"),
    supabase.from("proof_requests_safe").select("client_name, purpose").eq("id", interview.request_id).maybeSingle(),
  ]);
  // Onboarding answers are for the business only: they never become a case study.
  if (requestResult.data?.purpose === "onboarding") return { ok: false, error: "not_found" };
  const rows = (messagesResult.data ?? []).map((m) => ({ id: String(m.id), role: String(m.role), content: String(m.content) }));
  const clientMessages: ClientMessage[] = rows
    .filter((r) => r.role === "client")
    .map((r, i) => ({ alias: `m${i + 1}`, id: r.id, content: normalizeAnswer(r.content) }));
  if (clientMessages.length === 0) return { ok: false, error: "no_claims" };

  let aiCalls = 0;

  // 1. Extract, then verify each quote word for word.
  aiCalls++;
  const extractionText = await ask(ai, EXTRACTION_SYSTEM, `<transcript>\n${transcriptText(rows, clientMessages)}\n</transcript>`, EXTRACTION_TOKENS);
  if (extractionText === null) return { ok: false, error: "ai_failed" };
  const claims = verifyClaims(extractJson(extractionText), clientMessages);
  if (claims.length === 0) return { ok: false, error: "no_claims" };

  const refs = new Map<string, ClaimRef>(claims.map((c) => [c.alias, { id: c.alias, sourceQuote: c.quote, messageContent: c.messageContent }]));

  // 2. Draft from verified claims and the client's own answers only.
  const claimsJson = JSON.stringify(claims.map((c) => ({ id: c.alias, kind: c.kind, text: c.text, quote: c.quote })));
  const answers = clientMessages.map((m) => `[${m.alias}] ${sanitizeForModel(m.content)}`).join("\n");
  const prompt = `Verified claims:\n${claimsJson}\n\n<client_answers>\n${answers}\n</client_answers>\n\nWrite the case study now.`;

  // 3. Verify in code. One retry with the failures spelled out.
  aiCalls++;
  let draft = await draftOnce(ai, prompt);
  let issues: Issue[] = draft ? verifyContent(draft, refs) : [{ kind: "unknown_claim", where: "draft", detail: "The draft was not valid JSON in the expected shape" }];
  if (issues.length > 0) {
    aiCalls++;
    const retry = await draftOnce(ai, `${prompt}\n\n${feedbackMessage(issues)}`);
    if (retry) {
      draft = retry;
      issues = verifyContent(retry, refs);
    }
  }
  if (!draft) return { ok: false, error: "ai_failed" };

  // Still failing: remove what cannot be verified, and tell the owner what was removed.
  const verified = issues.length > 0 ? redactUnverified(draft, refs) : draft;

  // Naming follows the client's permission, never the model.
  const identity = clientIdentity(interview.publish_permission, String(requestResult.data?.client_name ?? ""));
  const uuidOf = new Map(claims.map((c) => [c.alias, c.uuid] as const));
  const final = caseStudyContentSchema.safeParse({
    ...verified,
    client: identity.name ? { name: identity.name } : {},
    sections: verified.sections.map((section) => ({
      ...section,
      ...(section.metrics ? { metrics: section.metrics.map((m) => ({ ...m, claimId: uuidOf.get(m.claimId) ?? m.claimId })) } : {}),
      ...(section.quote ? { quote: { ...section.quote, attribution: identity.attribution, claimId: uuidOf.get(section.quote.claimId) ?? section.quote.claimId } } : {}),
    })),
  });
  if (!final.success) return { ok: false, error: "failed" };

  // The generation counts against the workspace's AI usage.
  await supabase.rpc("bump_ai_usage", { ws: workspaceId, amount: Math.min(aiCalls, 10) });

  const { data: id, error } = await supabase.rpc("create_generated_case_study", {
    ws: workspaceId,
    intr: interviewId,
    new_content: final.data,
    issues: issues.slice(0, 30),
    claim_rows: claims.map((c) => ({ id: c.uuid, text: c.text, source_message_id: c.messageId, source_quote: c.quote })),
  });
  if (error || typeof id !== "string") {
    if (error?.code === "23505") return { ok: false, error: "exists" };
    if (error?.code === "42501") return { ok: false, error: "forbidden" };
    if (error?.code === "22023") return { ok: false, error: "not_complete" };
    return { ok: false, error: "failed" };
  }
  return { ok: true, caseStudyId: id, issues, claimCount: claims.length };
}

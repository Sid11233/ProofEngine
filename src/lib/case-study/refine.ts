import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiClient } from "@/lib/ai/client";
import { loadCaseStudy } from "./load";
import { PRESETS, QUOTE_REFUSAL, readField, refineInputSchema, refineWithModel, verifyRefinement, type Preset } from "./refine-core";

// The server side of "Refine with AI". Suggesting saves nothing; accepting goes through apply_text_refinement,
// which re-checks role, state and the current text in the database. Only token counts are ever logged.

export type RefineError = "forbidden" | "invalid" | "quote" | "not_found" | "published" | "limit" | "ai_failed" | "unsafe" | "stale" | "too_soon" | "expired" | "nothing_to_restore" | "failed";

export const REFINE_MESSAGES: Record<RefineError, string> = {
  forbidden: "You do not have permission to do that.",
  invalid: "That field cannot be refined.",
  quote: QUOTE_REFUSAL,
  not_found: "That case study was not found.",
  published: "Unpublish this case study before editing it.",
  limit: "You have used this month's AI refinements for your plan.",
  ai_failed: "The AI service did not respond. Please try again.",
  unsafe: "We could not produce a rewrite that keeps every fact intact. Try a different preset or edit it by hand.",
  stale: "This text changed after the suggestion was made. Please try again.",
  too_soon: "Please wait a moment before accepting another change.",
  expired: "This suggestion has expired. Please try again.",
  nothing_to_restore: "There is nothing to restore for this field.",
  failed: "Something went wrong. Please try again.",
};

export interface RefineDeps {
  supabase: SupabaseClient;
  ai: AiClient;
  workspace: { id: string; role: string };
  userId: string;
  /** Model name recorded with an accepted refinement (never the key or the text). */
  model: string;
  /** Signing key for suggestion tickets. */
  secret: string;
}

export interface Suggestion {
  original: string;
  suggested: string;
  /** Proves to the accept step which suggestion this was (user, field, text, preset, token counts). */
  ticket: string;
}

export type RefineResult = { ok: true; suggestion: Suggestion } | { ok: false; error: RefineError };

// ---------------------------------------------------------------------------------------------------------------------
// Tickets: the browser sends the suggestion back to accept it, so tokens and model are signed rather than trusted.
// ---------------------------------------------------------------------------------------------------------------------

const TICKET_MINUTES = 15;
interface TicketBody { u: string; c: string; f: string; h: string; p: Preset; m: string; i: number; o: number; e: number }

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const sign = (secret: string, body: string) => createHmac("sha256", secret).update(`refine:v1:${body}`).digest("base64url");

export function makeTicket(secret: string, body: Omit<TicketBody, "e" | "h"> & { text: string }, now = Date.now()): string {
  const { text, ...rest } = body;
  const payload = Buffer.from(JSON.stringify({ ...rest, h: sha(text), e: now + TICKET_MINUTES * 60_000 } satisfies TicketBody)).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

export function readTicket(secret: string, ticket: string, now = Date.now()): TicketBody | "expired" | null {
  const [payload, mac, extra] = ticket.split(".");
  if (!payload || !mac || extra !== undefined) return null;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString()) as TicketBody;
    if (typeof body.e !== "number" || !PRESETS.includes(body.p)) return null;
    return body.e < now ? "expired" : body;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Suggest
// ---------------------------------------------------------------------------------------------------------------------

async function brandTone(supabase: SupabaseClient, workspaceId: string): Promise<string | undefined> {
  const { data } = await supabase.from("workspaces").select("description, niche, audience").eq("id", workspaceId).maybeSingle();
  const parts = [data?.description, data?.niche && `Niche: ${data.niche}`, data?.audience && `Audience: ${data.audience}`].filter((p): p is string => typeof p === "string" && p !== "");
  return parts.length ? parts.join(". ") : undefined;
}

export async function refineText(deps: RefineDeps, rawInput: unknown): Promise<RefineResult> {
  const { supabase, ai, workspace } = deps;
  if (workspace.role === "viewer") return { ok: false, error: "forbidden" };

  const parsed = refineInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { caseStudyId, fieldPath, preset, instruction } = parsed.data;

  // Row-level security makes another workspace's case study simply "not found".
  const study = await loadCaseStudy(supabase, caseStudyId);
  if (!study || study.workspaceId !== workspace.id) return { ok: false, error: "not_found" };
  if (study.status === "published") return { ok: false, error: "published" };

  const field = readField(study.content, fieldPath);
  if (!field.ok) return { ok: false, error: field.reason };

  // Count it against the plan before spending anything; give it back if nothing useful came of it.
  const { data: reserved, error: reserveError } = await supabase.rpc("reserve_refinement", { ws: workspace.id });
  if (reserveError) return { ok: false, error: reserveError.code === "42501" ? "forbidden" : "failed" };
  if (reserved !== true) return { ok: false, error: "limit" };

  const tone = preset === "brand" ? await brandTone(supabase, workspace.id) : undefined;
  const result = await refineWithModel(ai, { text: field.text, preset, instruction, brandTone: tone });
  if (!result.ok) {
    await supabase.rpc("release_refinement", { ws: workspace.id });
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    suggestion: {
      original: field.text,
      suggested: result.text,
      ticket: makeTicket(deps.secret, { u: deps.userId, c: caseStudyId, f: fieldPath, text: result.text, p: preset, m: deps.model, i: result.inputTokens, o: result.outputTokens }),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Accept and restore
// ---------------------------------------------------------------------------------------------------------------------

const DB_ERRORS: Record<string, RefineError> = { "42501": "forbidden", "22023": "published", "40001": "stale", "54000": "too_soon" };

export type ApplyResult = { ok: true; version: number; text: string } | { ok: false; error: RefineError };

/** Applies a suggestion the user accepted. The ticket and the checks are repeated here because the browser sent the text back. */
export async function acceptRefinement(deps: RefineDeps, input: { caseStudyId: string; fieldPath: string; suggested: string; ticket: string }): Promise<ApplyResult> {
  const { supabase, workspace } = deps;
  if (workspace.role === "viewer") return { ok: false, error: "forbidden" };

  const ticket = readTicket(deps.secret, input.ticket);
  if (ticket === "expired") return { ok: false, error: "expired" };
  if (!ticket || ticket.u !== deps.userId || ticket.c !== input.caseStudyId || ticket.f !== input.fieldPath || ticket.h !== sha(input.suggested)) return { ok: false, error: "invalid" };

  const study = await loadCaseStudy(supabase, input.caseStudyId);
  if (!study || study.workspaceId !== workspace.id) return { ok: false, error: "not_found" };
  const field = readField(study.content, input.fieldPath);
  if (!field.ok) return { ok: false, error: field.reason };
  if (verifyRefinement(field.text, input.suggested).length > 0) return { ok: false, error: "unsafe" };

  const { data, error } = await supabase.rpc("apply_text_refinement", {
    study: input.caseStudyId, path: input.fieldPath, original: field.text, new_text: input.suggested, preset: ticket.p, model: ticket.m, in_tokens: ticket.i, out_tokens: ticket.o, restoring: false,
  });
  if (error || typeof data !== "number") return { ok: false, error: DB_ERRORS[error?.code ?? ""] ?? "failed" };
  return { ok: true, version: data, text: input.suggested.trim() };
}

/** Puts back the wording the field had before it was first refined (since the last restore). */
export async function restoreOriginal(deps: RefineDeps, input: { caseStudyId: string; fieldPath: string }): Promise<ApplyResult> {
  const { supabase, workspace } = deps;
  if (workspace.role === "viewer") return { ok: false, error: "forbidden" };

  const study = await loadCaseStudy(supabase, input.caseStudyId);
  if (!study || study.workspaceId !== workspace.id) return { ok: false, error: "not_found" };
  const field = readField(study.content, input.fieldPath);
  if (!field.ok) return { ok: false, error: field.reason };

  const { data: log } = await supabase
    .from("text_refinements")
    .select("original_text, preset, created_at")
    .eq("case_study_id", input.caseStudyId)
    .eq("field_path", input.fieldPath)
    .order("created_at", { ascending: true });
  const rows = log ?? [];
  const lastRestore = rows.map((r) => r.preset).lastIndexOf("restore");
  const first = rows.slice(lastRestore + 1)[0];
  if (!first || typeof first.original_text !== "string") return { ok: false, error: "nothing_to_restore" };

  const { data, error } = await supabase.rpc("apply_text_refinement", {
    study: input.caseStudyId, path: input.fieldPath, original: field.text, new_text: first.original_text, preset: "restore", model: deps.model, in_tokens: 0, out_tokens: 0, restoring: true,
  });
  if (error || typeof data !== "number") return { ok: false, error: DB_ERRORS[error?.code ?? ""] ?? "failed" };
  return { ok: true, version: data, text: first.original_text };
}

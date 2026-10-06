"use server";
import "server-only";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAiClient } from "@/lib/ai/factory";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { aiMessageLimitFor } from "@/lib/limits";
import { limits } from "@/lib/limits.server";
import { getClientIp } from "@/lib/security/client-ip";
import { serverEnv } from "@/lib/security/env.server";
import { buildDrafts } from "@/lib/social/builder";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export interface SocialResult {
  ok: boolean;
  message?: string;
}

const NO = "You do not have permission to do that.";

async function editor() {
  const workspace = await getCurrentWorkspace();
  return workspace && workspace.role !== "viewer" ? workspace : null;
}

/** Writes new drafts from the client's confirmed claims. The database refuses unless consent was given. */
export async function generateDraftsAction(id: string): Promise<SocialResult> {
  const user = await requireUser();
  const workspace = await editor();
  if (!workspace) return { ok: false, message: NO };
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "That case study was not found." };

  if (!(await isAuthAttemptAllowed("social-drafts", { ip: getClientIp(await headers()), subject: user.id }))) return { ok: false, message: RATE_LIMITED_MESSAGE };
  const ai = createAiClient(serverEnv, "generator", { timeoutMs: 50_000 });
  if (!ai) return { ok: false, message: "AI is not configured on this server yet." };

  const supabase = await createClient();
  const period = new Date().toISOString().slice(0, 7) + "-01";
  const { data: usage } = await supabase.from("usage_counters").select("ai_messages").eq("workspace_id", workspace.id).eq("period", period).maybeSingle();
  if (Number(usage?.ai_messages ?? 0) + 1 > aiMessageLimitFor(workspace.plan, limits)) return { ok: false, message: "Your workspace has used its AI allowance for this month." };

  // Only claims the client confirmed when approving. Row-level security scopes this to the workspace.
  const { data: rows } = await supabase.from("claims").select("text, source_quote").eq("case_study_id", id).eq("workspace_id", workspace.id).eq("client_confirmed", true).limit(30);
  const claims = (rows ?? []).map((r) => ({ text: String(r.text), sourceQuote: String(r.source_quote) }));
  if (claims.length === 0) return { ok: false, message: "There are no confirmed claims to write from." };

  const built = await buildDrafts(ai, claims);
  if (!built.ok) return { ok: false, message: built.error === "ai_failed" ? "The AI service did not respond. Please try again." : "We could not write drafts we can verify. Please try again." };

  const { error } = await supabase.rpc("create_social_drafts", { study: id, drafts: built.drafts });
  if (error) {
    if (error.code === "22023") return { ok: false, message: "Social posts need a published case study whose client agreed to them." };
    if (error.code === "53400") return { ok: false, message: "This case study has too many saved drafts. Discard some first." };
    return { ok: false, message: error.code === "42501" ? NO : "We could not save the drafts. Please try again." };
  }
  await supabase.rpc("bump_ai_usage", { ws: workspace.id, amount: 1 });
  revalidatePath(`/app/case-studies/${id}/social`);
  return { ok: true };
}

const statusSchema = z.object({ id: z.uuid(), status: z.enum(["draft", "saved", "posted"]) }).strict();

export async function setPostStatusAction(input: unknown): Promise<SocialResult> {
  await requireUser();
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success || !(await editor())) return { ok: false, message: NO };
  const { error } = await (await createClient()).from("social_posts").update({ status: parsed.data.status }).eq("id", parsed.data.id);
  if (error) return { ok: false, message: "We could not update that draft." };
  revalidatePath("/app/case-studies/[id]/social", "page");
  return { ok: true };
}

export async function discardPostAction(id: string): Promise<SocialResult> {
  await requireUser();
  if (!z.uuid().safeParse(id).success || !(await editor())) return { ok: false, message: NO };
  const { error } = await (await createClient()).from("social_posts").delete().eq("id", id);
  if (error) return { ok: false, message: "We could not discard that draft." };
  revalidatePath("/app/case-studies/[id]/social", "page");
  return { ok: true };
}

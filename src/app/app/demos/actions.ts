"use server";

import "server-only";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAiClient } from "@/lib/ai/factory";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { draftChat, DEMO_AI_MESSAGES, suggestTooltip } from "@/lib/demos/ai";
import { getDemoStore } from "@/lib/demos/assets-server";
import { createDemo, DEMO_ERROR_MESSAGES, publishDemo, saveDemo, unpublishDemo, type DemoError } from "@/lib/demos/service";
import type { TextFinding } from "@/lib/demos/redaction";
import { getClientIp } from "@/lib/security/client-ip";
import { serverEnv } from "@/lib/security/env.server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export interface DemoActionResult {
  ok: boolean;
  message?: string;
  issues?: string[];
  findings?: TextFinding[];
  slug?: string;
}

const idSchema = z.uuid();
const fail = (error: DemoError | "rate_limited", issues?: string[]): DemoActionResult => ({
  ok: false,
  message: error === "rate_limited" ? RATE_LIMITED_MESSAGE : DEMO_ERROR_MESSAGES[error],
  issues,
});

/** Signed in, editor or above in the caller's own workspace, and under the rate limit. */
async function authorise(action: "demo-edit" | "demo-ai" = "demo-edit") {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace || workspace.role === "viewer") return "forbidden" as const;
  if (!(await isAuthAttemptAllowed(action, { ip: getClientIp(await headers()), subject: user.id }))) return "rate_limited" as const;
  return { user, workspace };
}

export async function createDemoAction(_prev: DemoActionResult | null, formData: FormData): Promise<DemoActionResult> {
  const auth = await authorise();
  if (typeof auth === "string") return fail(auth);
  const result = await createDemo(await createClient(), { workspaceId: auth.workspace.id, userId: auth.user.id }, formData.get("title"));
  if (!result.ok) return fail(result.error);
  revalidatePath("/app/demos");
  redirect(`/app/demos/${result.id}`);
}

/** Autosave and the Save button. The server validates everything again; the browser's view of the content is never trusted. */
export async function saveDemoAction(id: string, input: unknown): Promise<DemoActionResult> {
  const auth = await authorise();
  if (typeof auth === "string") return fail(auth);
  const result = await saveDemo(await createClient(), id, input);
  return result.ok ? { ok: true, findings: result.findings } : fail(result.error, result.issues);
}

export async function publishDemoAction(id: string, slug: string): Promise<DemoActionResult> {
  const auth = await authorise();
  if (typeof auth === "string") return fail(auth);
  const result = await publishDemo(await createClient(), id, slug);
  if (!result.ok) return fail(result.error);
  revalidatePath("/app/demos");
  return { ok: true, slug: result.slug };
}

export async function unpublishDemoAction(id: string): Promise<DemoActionResult> {
  const auth = await authorise();
  if (typeof auth === "string") return fail(auth);
  const result = await unpublishDemo(await createClient(), id);
  if (!result.ok) return fail(result.error);
  revalidatePath("/app/demos");
  return { ok: true };
}

/** Admins and owners only. Files go first, then the rows (which cascade), so a failure never leaves files nobody can find. */
export async function deleteDemoAction(id: string): Promise<DemoActionResult> {
  const auth = await authorise();
  if (typeof auth === "string") return fail(auth);
  if (auth.workspace.role !== "owner" && auth.workspace.role !== "admin") return fail("forbidden");
  if (!idSchema.safeParse(id).success) return fail("not_found");
  const supabase = await createClient();
  const { data: demo } = await supabase.from("demos").select("id, status").eq("id", id).maybeSingle();
  if (!demo) return fail("not_found");
  if (demo.status === "published") return fail("locked");
  const { data: assets } = await supabase.from("demo_assets").select("file_path").eq("demo_id", id);
  const store = getDemoStore();
  for (const asset of assets ?? []) await store.remove(String(asset.file_path));
  const { data, error } = await supabase.from("demos").delete().eq("id", id).select("id");
  if (error || !data?.length) return fail("failed");
  revalidatePath("/app/demos");
  return { ok: true };
}

export interface SuggestionResult { ok: boolean; message?: string; tooltip?: { title: string; body: string }; messages?: Array<{ from: "user" | "agent"; text: string }> }

async function withAi<T>(notes: unknown, run: (ai: NonNullable<ReturnType<typeof createAiClient>>, notes: string) => Promise<{ ok: true; value: T; inputTokens: number; outputTokens: number } | { ok: false; error: keyof typeof DEMO_AI_MESSAGES }>) {
  const auth = await authorise("demo-ai");
  if (typeof auth === "string") return { ok: false as const, message: DEMO_AI_MESSAGES[auth] };
  const ai = createAiClient(serverEnv, "generator");
  if (!ai) return { ok: false as const, message: DEMO_AI_MESSAGES.not_configured };
  const result = await run(ai, typeof notes === "string" ? notes : "");
  if (!result.ok) return { ok: false as const, message: DEMO_AI_MESSAGES[result.error] };
  // Token counts only; never the notes or the suggestion.
  console.info("demo ai", { inputTokens: result.inputTokens, outputTokens: result.outputTokens });
  return { ok: true as const, value: result.value };
}

/** Suggestions are returned to the form and saved only if the owner accepts them and saves. */
export async function suggestTooltipAction(notes: unknown): Promise<SuggestionResult> {
  const r = await withAi(notes, suggestTooltip);
  return r.ok ? { ok: true, tooltip: r.value } : r;
}

export async function draftChatAction(notes: unknown): Promise<SuggestionResult> {
  const r = await withAi(notes, draftChat);
  return r.ok ? { ok: true, messages: r.value.messages } : r;
}

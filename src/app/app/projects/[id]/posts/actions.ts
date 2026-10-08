"use server";

import "server-only";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAiClient } from "@/lib/ai/factory";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { aiMessageLimitFor } from "@/lib/limits";
import { limits } from "@/lib/limits.server";
import { getClientIp } from "@/lib/security/client-ip";
import { serverEnv } from "@/lib/security/env.server";
import { discardProjectPost, editProjectPost, generateProjectPosts, POSTS_MESSAGES } from "@/lib/social/project-posts";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export interface PostsResult {
  ok: boolean;
  message?: string;
}

const NO = POSTS_MESSAGES.forbidden;

async function authorise(action: "social-drafts" | "case-study-edit") {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace || workspace.role === "viewer") return "forbidden" as const;
  if (!(await isAuthAttemptAllowed(action, { ip: getClientIp(await headers()), subject: user.id }))) return "throttled" as const;
  return { user, workspace };
}

export async function generatePostsAction(projectId: string, input: unknown): Promise<PostsResult> {
  const auth = await authorise("social-drafts");
  if (auth === "forbidden") return { ok: false, message: NO };
  if (auth === "throttled") return { ok: false, message: RATE_LIMITED_MESSAGE };
  const ai = createAiClient(serverEnv, "generator", { timeoutMs: 55_000 });
  if (!ai) return { ok: false, message: "AI is not configured on this server yet." };

  const supabase = await createClient();
  const period = new Date().toISOString().slice(0, 7) + "-01";
  const { data: usage } = await supabase.from("usage_counters").select("ai_messages").eq("workspace_id", auth.workspace.id).eq("period", period).maybeSingle();
  if (Number(usage?.ai_messages ?? 0) + 1 > aiMessageLimitFor(auth.workspace.plan, limits)) return { ok: false, message: "Your workspace has used its AI allowance for this month." };

  const result = await generateProjectPosts({ supabase, ai }, { workspaceId: auth.workspace.id, userId: auth.user.id }, projectId, input);
  if (!result.ok) return { ok: false, message: result.message ?? POSTS_MESSAGES[result.error] };
  await supabase.rpc("bump_ai_usage", { ws: auth.workspace.id, amount: 1 });
  revalidatePath(`/app/projects/${projectId}/posts`);
  return { ok: true, message: result.dropped > 0 ? `${result.created} ready. ${result.dropped} others were dropped because they used facts that are not in your project.` : `${result.created} ready.` };
}

export async function editPostAction(projectId: string, postId: string, input: unknown): Promise<PostsResult> {
  const auth = await authorise("case-study-edit");
  if (auth === "forbidden") return { ok: false, message: NO };
  if (auth === "throttled") return { ok: false, message: RATE_LIMITED_MESSAGE };
  const result = await editProjectPost(await createClient(), postId, input);
  if (!result.ok) return { ok: false, message: POSTS_MESSAGES[result.error] };
  revalidatePath(`/app/projects/${projectId}/posts`);
  return { ok: true, message: "Saved." };
}

export async function discardPostAction(projectId: string, postId: string): Promise<PostsResult> {
  const auth = await authorise("case-study-edit");
  if (auth === "forbidden") return { ok: false, message: NO };
  if (auth === "throttled") return { ok: false, message: RATE_LIMITED_MESSAGE };
  const result = await discardProjectPost(await createClient(), postId);
  if (!result.ok) return { ok: false, message: POSTS_MESSAGES[result.error] };
  revalidatePath(`/app/projects/${projectId}/posts`);
  return { ok: true };
}

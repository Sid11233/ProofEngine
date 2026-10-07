import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthAttemptAllowed } from "@/lib/auth/rate-limits";
import { getUser } from "@/lib/auth/session";
import { getClientIp } from "@/lib/security/client-ip";
import { publicEnv } from "@/lib/security/env.public";
import { isSameOrigin } from "@/lib/security/origin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export interface DemoEditContext { userId: string; workspaceId: string; demoId: string }

/**
 * Every demo write route starts here: same origin, signed in, editor or above in the caller's own workspace,
 * rate limited, and the demo must exist in that workspace (row level security hides other workspaces' demos) and
 * be editable (not published, not blocked). Returns the context or a ready response.
 */
export async function guardDemoEdit(request: Request, demoId: string): Promise<DemoEditContext | NextResponse> {
  if (!isSameOrigin(request, publicEnv.NEXT_PUBLIC_APP_URL)) return json({ error: "forbidden" }, 403);
  const user = await getUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  const workspace = await getCurrentWorkspace();
  if (!workspace || workspace.role === "viewer") return json({ error: "forbidden" }, 403);
  if (!z.uuid().safeParse(demoId).success) return json({ error: "not_found" }, 404);
  if (!(await isAuthAttemptAllowed("demo-assets", { ip: getClientIp(request.headers), subject: user.id }))) return json({ error: "rate_limited" }, 429);

  const { data: demo } = await (await createClient()).from("demos").select("id, workspace_id, status").eq("id", demoId).maybeSingle();
  if (!demo || demo.workspace_id !== workspace.id) return json({ error: "not_found" }, 404);
  if (demo.status === "published") return json({ error: "published", message: "Unpublish this demo before changing its images." }, 409);
  if (demo.status === "blocked") return json({ error: "blocked", message: "This demo is blocked." }, 409);
  return { userId: user.id, workspaceId: workspace.id, demoId };
}

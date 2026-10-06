"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { removeTrackerSchema, trackerInputSchema } from "@/lib/finder/schemas";
import { getClientIp } from "@/lib/security/client-ip";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export interface FinderActionResult {
  ok: boolean;
  message?: string;
}

/** Editor and above. The workspace comes from the caller's own membership, never from the request. */
async function guard() {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace || workspace.role === "viewer") return { error: "You do not have permission to do that." } as const;
  if (!(await isAuthAttemptAllowed("finder", { ip: getClientIp(await headers()), subject: user.id }))) return { error: RATE_LIMITED_MESSAGE } as const;
  return { workspace } as const;
}

export async function saveTrackerAction(input: unknown): Promise<FinderActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, message: g.error };
  const parsed = trackerInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Those details are not valid." };

  // Row-level security decides who may do this (editors of this workspace, active communities only).
  // Update first (only status and notes are updatable), then insert if the community was not tracked yet.
  const supabase = await createClient();
  const values = { status: parsed.data.status, notes: parsed.data.notes || null };
  const { data: updated, error: updateError } = await supabase.from("workspace_communities").update(values).eq("workspace_id", g.workspace.id).eq("community_id", parsed.data.communityId).select("community_id");
  if (updateError) return { ok: false, message: "We could not save that." };
  if (!updated?.length) {
    const { error } = await supabase.from("workspace_communities").insert({ workspace_id: g.workspace.id, community_id: parsed.data.communityId, ...values });
    if (error) return { ok: false, message: "We could not save that." };
  }
  revalidatePath("/app/finder");
  return { ok: true, message: "Saved." };
}

export async function removeTrackerAction(input: unknown): Promise<FinderActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, message: g.error };
  const parsed = removeTrackerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That community was not found." };
  const { error } = await (await createClient()).from("workspace_communities").delete().eq("workspace_id", g.workspace.id).eq("community_id", parsed.data.communityId);
  if (error) return { ok: false, message: "We could not remove that." };
  revalidatePath("/app/finder");
  return { ok: true };
}

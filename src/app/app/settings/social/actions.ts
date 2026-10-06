"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { getClientIp } from "@/lib/security/client-ip";
import { NETWORKS } from "@/lib/social/networks";
import { profilesSchema } from "@/lib/social/profiles";
import { safeProfileUrl } from "@/lib/social/share";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { fieldErrorsOf, type FormState } from "@/lib/validation/form";

/** Saves the optional profile links. Admins and owners only; row-level security checks it again. */
export async function saveSocialProfilesAction(input: unknown): Promise<FormState> {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace || (workspace.role !== "owner" && workspace.role !== "admin")) return { ok: false, message: "Only admins and owners can change this." };

  const parsed = profilesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  if (!(await isAuthAttemptAllowed("wall-settings", { ip: getClientIp(await headers()), subject: user.id }))) return { ok: false, message: RATE_LIMITED_MESSAGE };

  const supabase = await createClient();
  for (const network of NETWORKS) {
    const url = safeProfileUrl(network, parsed.data[network]);
    const { error } = url
      ? await upsertProfile(supabase, workspace.id, network, url)
      : await supabase.from("social_profiles").delete().eq("workspace_id", workspace.id).eq("network", network);
    if (error) return { ok: false, message: "We could not save your links. Please try again." };
  }
  revalidatePath("/app/settings/social");
  return { ok: true, message: "Saved." };
}

async function upsertProfile(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string, network: string, url: string) {
  // Insert, or change only the url: the table grants no other column.
  const existing = await supabase.from("social_profiles").select("network").eq("workspace_id", workspaceId).eq("network", network).maybeSingle();
  return existing.data
    ? supabase.from("social_profiles").update({ url }).eq("workspace_id", workspaceId).eq("network", network)
    : supabase.from("social_profiles").insert({ workspace_id: workspaceId, network, url });
}

"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { getClientIp } from "@/lib/security/client-ip";
import { createClient } from "@/lib/supabase/server";
import { parseOrigins, wallSettingsSchema } from "@/lib/wall/schemas";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import type { FormState } from "@/lib/validation/form";

/** Admin and above. The workspace comes from the caller's own membership, never from the request. */
export async function saveWallSettingsAction(input: { enabled: boolean; originsText: string; layout: string; maxItems: number }): Promise<FormState> {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace || (workspace.role !== "owner" && workspace.role !== "admin")) return { ok: false, message: "Only admins and owners can change this." };
  if (!(await isAuthAttemptAllowed("wall-settings", { ip: getClientIp(await headers()), subject: user.id }))) return { ok: false, message: RATE_LIMITED_MESSAGE };

  const origins = typeof input.originsText === "string" ? parseOrigins(input.originsText.slice(0, 4000)) : { ok: false as const, bad: "" };
  if (!origins.ok) return { ok: false, message: `"${origins.bad}" is not a valid site. Use https://example.com, one per line, no paths or wildcards.`, fieldErrors: { origins: ["Invalid site"] } };

  const parsed = wallSettingsSchema.safeParse({ enabled: input.enabled, origins: origins.origins, layout: input.layout, maxItems: input.maxItems });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Those settings are not valid." };

  const { error } = await (await createClient()).rpc("save_wall_settings", {
    ws: workspace.id,
    is_enabled: parsed.data.enabled,
    origins: parsed.data.origins,
    chosen_layout: parsed.data.layout,
    item_limit: parsed.data.maxItems,
  });
  if (error) return { ok: false, message: "We could not save the settings." };
  revalidatePath("/app/settings/wall");
  return { ok: true, message: "Saved. The change reaches public pages within a minute." };
}

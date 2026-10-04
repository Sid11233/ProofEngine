import "server-only";
import { cache } from "react";
import { z } from "zod";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const roleSchema = z.enum(["owner", "admin", "editor", "viewer"]);

const membershipSchema = z.object({
  role: roleSchema,
  workspaces: z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(["agency", "saas"]),
    plan: z.enum(["free", "pro", "team"]),
    subdomain_slug: z.string().nullable(),
  }),
});

export type Role = z.infer<typeof roleSchema>;
export interface CurrentWorkspace {
  id: string;
  name: string;
  type: "agency" | "saas";
  plan: "free" | "pro" | "team";
  subdomainSlug: string | null;
  role: Role;
}

/**
 * The signed-in user's workspace, read under their own RLS. V1 has one workspace
 * per user in the UI (the oldest membership); multi-workspace switching comes later.
 */
export const getCurrentWorkspace = cache(async (): Promise<CurrentWorkspace | null> => {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  // RLS lets members read every row of their own workspaces, so the query must be
  // pinned to the caller's own membership or it would return a teammate's role.
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspaces(id, name, type, plan, subdomain_slug)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error || !data?.length) return null;
  const parsed = membershipSchema.safeParse(data[0]);
  if (!parsed.success) return null;

  const { role, workspaces: ws } = parsed.data;
  return { id: ws.id, name: ws.name, type: ws.type, plan: ws.plan, subdomainSlug: ws.subdomain_slug, role };
});

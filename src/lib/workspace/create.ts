import type { SupabaseClient } from "@supabase/supabase-js";
import type { OnboardingInput } from "./schemas";
import { slugCandidates } from "./slug";

export class WorkspaceLimitError extends Error {
  constructor() {
    super("Workspace limit reached");
  }
}

const MAX_SLUG_ATTEMPTS = 8;
const UNIQUE_VIOLATION = "23505";
const PROGRAM_LIMIT_EXCEEDED = "54000";

/**
 * Creates a workspace through the create_workspace() database function (never a
 * direct insert), then fills in the profile and a subdomain slug. If anything after
 * the first step fails, the half-built workspace is deleted so onboarding can be
 * retried cleanly.
 *
 * Takes the caller's Supabase client, so every statement runs under their RLS.
 */
export async function createWorkspaceWithProfile(
  supabase: SupabaseClient,
  input: OnboardingInput,
  candidates: Iterable<string> = slugCandidates(input.name),
): Promise<{ id: string; slug: string }> {
  const { data: id, error: createError } = await supabase.rpc("create_workspace", {
    name: input.name,
    type: input.type,
  });
  if (createError || typeof id !== "string") {
    if (createError?.code === PROGRAM_LIMIT_EXCEEDED) throw new WorkspaceLimitError();
    throw new Error("Could not create the workspace");
  }

  let attempts = 0;
  for (const slug of candidates) {
    if (attempts++ >= MAX_SLUG_ATTEMPTS) break;

    const { data, error } = await supabase
      .from("workspaces")
      .update({
        niche: input.niche,
        audience: input.audience,
        website: input.website ?? null,
        description: input.description,
        subdomain_slug: slug,
      })
      .eq("id", id)
      .select("subdomain_slug")
      .single();

    if (!error && data) return { id, slug: String(data.subdomain_slug) };
    // Slug taken by someone else: try the next candidate. Anything else is a real failure.
    if (error?.code !== UNIQUE_VIOLATION) break;
  }

  await supabase.from("workspaces").delete().eq("id", id);
  throw new Error("Could not finish setting up the workspace");
}

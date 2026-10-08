import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AiClient } from "@/lib/ai/client";
import { cleanParagraph } from "@/lib/takedown/schemas";
import { MAX_HEADING, MAX_SLIDE_BODY, MAX_SLIDES, MIN_SLIDES, SLIDE_KINDS, supportsCarousel, type Slide } from "./carousel";
import { NETWORKS, type Network } from "./networks";
import { buildProjectItems, verifyCaption, verifySlides, type ProjectSources } from "./project-builder";

// The server side of "Posts and carousels" on a project. The user's own client throughout, so row level security
// (members read, editors write) has the last word; these functions add the typed-source checks and the attestation.

export type PostsError = "invalid" | "not_found" | "forbidden" | "no_facts" | "ai_failed" | "no_items" | "unverified" | "limit" | "failed";

export const POSTS_MESSAGES: Record<PostsError, string> = {
  invalid: "Please check what you entered.",
  not_found: "That was not found.",
  forbidden: "You do not have permission to do that.",
  no_facts: "Add a summary, some key facts or client feedback to the project first. Posts can only use what is written there.",
  ai_failed: "The AI service did not respond. Please try again.",
  no_items: "We could not write posts we can verify against your project. Add more detail and try again.",
  unverified: "That text uses a number, quote or link that is not in your project. Posts can only use numbers written in the project and quotes copied word for word from client feedback.",
  limit: "This project has too many saved posts. Discard some first.",
  failed: "Something went wrong. Please try again.",
};

export const generateSchema = z
  .object({
    networks: z.array(z.enum(NETWORKS)).min(1, "Choose at least one network").max(NETWORKS.length).refine((l) => new Set(l).size === l.length, "Duplicate network"),
    attested: z.literal(true, "Please confirm you have the client's permission"),
  })
  .strict();

const slideSchema = z.object({ kind: z.enum(SLIDE_KINDS), heading: z.string().transform(cleanParagraph).pipe(z.string().max(MAX_HEADING)), body: z.string().transform(cleanParagraph).pipe(z.string().max(MAX_SLIDE_BODY)) }).strict();
export const editSchema = z
  .object({
    body: z.string().transform(cleanParagraph).pipe(z.string().min(1, "The caption cannot be empty").max(3000)).optional(),
    slides: z.array(slideSchema).min(MIN_SLIDES).max(MAX_SLIDES).optional(),
    status: z.enum(["draft", "saved", "posted"]).optional(),
  })
  .strict();

export async function loadSources(supabase: SupabaseClient, projectId: string): Promise<ProjectSources | null> {
  const { data: project } = await supabase.from("projects").select("summary, key_facts").eq("id", projectId).maybeSingle();
  if (!project) return null;
  const { data: feedback } = await supabase.from("project_feedback").select("body, source").eq("project_id", projectId).order("created_at").limit(100);
  return {
    summary: project.summary ? String(project.summary) : undefined,
    highlights: project.key_facts ? String(project.key_facts) : undefined,
    feedback: (feedback ?? []).map((f) => ({ body: String(f.body), source: f.source === "team" ? ("team" as const) : ("client" as const) })),
  };
}

const hasFacts = (s: ProjectSources) => Boolean(s.summary || s.highlights || s.feedback.length > 0);

export async function generateProjectPosts(
  deps: { supabase: SupabaseClient; ai: AiClient },
  ctx: { workspaceId: string; userId: string },
  projectId: string,
  raw: unknown,
): Promise<{ ok: true; created: number; dropped: number } | { ok: false; error: PostsError; message?: string }> {
  const input = generateSchema.safeParse(raw);
  const id = z.uuid().safeParse(projectId);
  if (!id.success) return { ok: false, error: "not_found" };
  if (!input.success) return { ok: false, error: "invalid", message: input.error.issues[0]?.message };

  const sources = await loadSources(deps.supabase, id.data);
  if (!sources) return { ok: false, error: "not_found" };
  if (!hasFacts(sources)) return { ok: false, error: "no_facts" };

  const built = await buildProjectItems(deps.ai, input.data.networks as Network[], sources);
  if (!built.ok) return { ok: false, error: built.error };

  // New drafts replace old unsaved ones; saved and posted items are kept.
  await deps.supabase.from("project_posts").delete().eq("project_id", id.data).eq("status", "draft");
  const rows = built.items.map((item) => ({
    workspace_id: ctx.workspaceId, project_id: id.data, created_by: ctx.userId, network: item.network, kind: item.kind,
    body: item.body, slides: item.slides ?? null, attested: true,
  }));
  const { error } = await deps.supabase.from("project_posts").insert(rows);
  if (error) return { ok: false, error: error.code === "54000" ? "limit" : error.code === "42501" ? "forbidden" : "failed" };
  return { ok: true, created: rows.length, dropped: built.dropped };
}

/** Edits re-run the same checks against the project's current typed sources. */
export async function editProjectPost(supabase: SupabaseClient, postId: unknown, raw: unknown): Promise<{ ok: true } | { ok: false; error: PostsError }> {
  const id = z.uuid().safeParse(postId);
  const input = editSchema.safeParse(raw);
  if (!id.success) return { ok: false, error: "not_found" };
  if (!input.success || Object.keys(input.data).length === 0) return { ok: false, error: "invalid" };

  const { data: post } = await supabase.from("project_posts").select("project_id, network, kind").eq("id", id.data).maybeSingle();
  if (!post) return { ok: false, error: "not_found" };
  const update: { body?: string; slides?: Slide[]; status?: string } = {};
  if (input.data.status) update.status = input.data.status;

  if (input.data.body !== undefined || input.data.slides !== undefined) {
    const sources = await loadSources(supabase, String(post.project_id));
    if (!sources) return { ok: false, error: "not_found" };
    const network = post.network as Network;
    if (input.data.body !== undefined) {
      if (!verifyCaption(network, input.data.body, sources)) return { ok: false, error: "unverified" };
      update.body = input.data.body;
    }
    if (input.data.slides !== undefined) {
      if (post.kind !== "carousel" || !supportsCarousel(network) || !verifySlides(input.data.slides, sources)) return { ok: false, error: "unverified" };
      update.slides = input.data.slides;
    }
  }
  const { data, error } = await supabase.from("project_posts").update(update).eq("id", id.data).select("id");
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "failed" };
  return data?.length ? { ok: true } : { ok: false, error: "not_found" };
}

export async function discardProjectPost(supabase: SupabaseClient, postId: unknown): Promise<{ ok: true } | { ok: false; error: PostsError }> {
  const id = z.uuid().safeParse(postId);
  if (!id.success) return { ok: false, error: "not_found" };
  const { data, error } = await supabase.from("project_posts").delete().eq("id", id.data).select("id");
  return error ? { ok: false, error: "failed" } : data?.length ? { ok: true } : { ok: false, error: "not_found" };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { scanDemoText, type TextFinding } from "./redaction";
import { demoContentSchema, demoSettingsSchema, demoThemeSchema, validateDemoContent } from "./schema";

// The server side of the demo editor. Everything arrives as untrusted JSON: strict zod first, then the database
// (row level security, publish rules trigger, functions) has the last word. `supabase` is always the user's own client.

export type DemoError = "invalid" | "not_found" | "locked" | "forbidden" | "slug_taken" | "failed" | PublishBlock;
export type PublishBlock = "blocked" | "not_attested" | "not_redacted" | "flagged_assets" | "bad_slug" | "empty" | "plan_limit" | "invalid_state";

export const DEMO_ERROR_MESSAGES: Record<DemoError, string> = {
  invalid: "Some of the demo is not valid. Check the highlighted steps.",
  not_found: "That demo was not found.",
  locked: "Unpublish this demo before changing it.",
  forbidden: "You do not have permission to do that.",
  slug_taken: "That address is already used by another demo. Choose a different one.",
  failed: "Something went wrong. Please try again.",
  blocked: "This demo has been blocked and cannot be published.",
  not_attested: "Confirm that this demo is a true example before publishing.",
  not_redacted: "Confirm that you removed private information before publishing.",
  flagged_assets: "Confirm or blur every image before publishing.",
  bad_slug: "Use 3 to 40 lowercase letters, numbers and hyphens for the address.",
  empty: "Add at least one step before publishing.",
  plan_limit: "Your plan's limit of published demos is reached. Unpublish one or upgrade.",
  invalid_state: "This demo cannot be published right now.",
};

const title = z.string().trim().min(1).max(120).refine((v) => !/[<\u0000-\u001f]/.test(v), "Plain text only");
export const saveInputSchema = z
  .object({
    title: title.optional(),
    content: z.unknown().optional(),
    settings: z.unknown().optional(),
    theme: z.unknown().optional(),
    authenticity_attested: z.boolean().optional(),
    redaction_acknowledged: z.boolean().optional(),
  })
  .strict();
export const slugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/);

const idSchema = z.uuid();
export const DEFAULT_SETTINGS = demoSettingsSchema.parse({});
export const DEFAULT_THEME = demoThemeSchema.parse({});

export async function createDemo(supabase: SupabaseClient, ctx: { workspaceId: string; userId: string }, rawTitle: unknown): Promise<{ ok: true; id: string } | { ok: false; error: DemoError }> {
  const parsed = title.safeParse(rawTitle);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { data, error } = await supabase
    .from("demos")
    .insert({ workspace_id: ctx.workspaceId, created_by: ctx.userId, title: parsed.data, content: { scenes: [] }, settings: DEFAULT_SETTINGS, theme: DEFAULT_THEME })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.code === "42501" ? "forbidden" : "failed" };
  return { ok: true, id: String(data.id) };
}

export type SaveResult = { ok: true; findings: TextFinding[] } | { ok: false; error: DemoError; issues?: string[] };

export async function saveDemo(supabase: SupabaseClient, demoId: unknown, raw: unknown): Promise<SaveResult> {
  const id = idSchema.safeParse(demoId);
  const input = saveInputSchema.safeParse(raw);
  if (!id.success) return { ok: false, error: "not_found" };
  if (!input.success) return { ok: false, error: "invalid" };

  const update: Record<string, unknown> = {};
  let findings: TextFinding[] = [];
  if (input.data.title !== undefined) update.title = input.data.title;
  if (input.data.authenticity_attested !== undefined) update.authenticity_attested = input.data.authenticity_attested;
  if (input.data.redaction_acknowledged !== undefined) update.redaction_acknowledged = input.data.redaction_acknowledged;
  if (input.data.settings !== undefined) {
    const s = demoSettingsSchema.safeParse(input.data.settings);
    if (!s.success) return { ok: false, error: "invalid", issues: s.error.issues.map((i) => `settings.${i.path.join(".")}: ${i.message}`) };
    update.settings = s.data;
  }
  if (input.data.theme !== undefined) {
    const t = demoThemeSchema.safeParse(input.data.theme);
    if (!t.success) return { ok: false, error: "invalid" };
    update.theme = t.data;
  }
  if (input.data.content !== undefined) {
    // The images a demo may use are the rows of THIS demo (row level security hides every other workspace's).
    const { data: assets } = await supabase.from("demo_assets").select("id").eq("demo_id", id.data);
    const checked = validateDemoContent(input.data.content, new Set((assets ?? []).map((a) => String(a.id))));
    if (!checked.ok) return { ok: false, error: "invalid", issues: checked.issues };
    update.content = checked.content;
    findings = scanDemoText(checked.content);
  }
  if (Object.keys(update).length === 0) return { ok: true, findings };

  const { data, error } = await supabase.from("demos").update(update).eq("id", id.data).select("id");
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "failed" };
  // Row level security allows updates only to unpublished demos in your workspace: nothing updated means one of those.
  if (!data?.length) {
    const { data: row } = await supabase.from("demos").select("status").eq("id", id.data).maybeSingle();
    return { ok: false, error: !row ? "not_found" : "locked" };
  }
  return { ok: true, findings };
}

/** Maps the database's `publish_blocked:reason` errors to a reason. */
export function publishError(error: { code?: string; message?: string }): DemoError {
  const match = /publish_blocked:(\w+)/.exec(error.message ?? "");
  if (match && match[1] in DEMO_ERROR_MESSAGES) return match[1] as PublishBlock;
  if (error.code === "23505") return "slug_taken";
  if (error.code === "42501") return "forbidden";
  return "failed";
}

export async function publishDemo(supabase: SupabaseClient, demoId: unknown, rawSlug: unknown): Promise<{ ok: true; slug: string } | { ok: false; error: DemoError }> {
  const id = idSchema.safeParse(demoId);
  const slug = slugSchema.safeParse(rawSlug);
  if (!id.success) return { ok: false, error: "not_found" };
  if (!slug.success) return { ok: false, error: "bad_slug" };
  const { data, error } = await supabase.rpc("publish_demo", { demo: id.data, new_slug: slug.data });
  return error || typeof data !== "string" ? { ok: false, error: error ? publishError(error) : "failed" } : { ok: true, slug: data };
}

export async function unpublishDemo(supabase: SupabaseClient, demoId: unknown): Promise<{ ok: true } | { ok: false; error: DemoError }> {
  const id = idSchema.safeParse(demoId);
  if (!id.success) return { ok: false, error: "not_found" };
  const { error } = await supabase.rpc("unpublish_demo", { demo: id.data });
  return error ? { ok: false, error: error.code === "42501" ? "forbidden" : error.code === "22023" ? "invalid_state" : "failed" } : { ok: true };
}

export { demoContentSchema };

/** "https://Example.com/page?x" becomes "https://example.com"; anything that is not a plain https site is refused. */
export function normaliseOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 300) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return null;
    const origin = url.origin.toLowerCase();
    return /^https:\/\/[a-z0-9.-]+(:[0-9]+)?$/.test(origin) && origin.length <= 253 ? origin : null;
  } catch {
    return null;
  }
}

export async function addEmbedOrigin(supabase: SupabaseClient, demoId: unknown, rawOrigin: unknown): Promise<{ ok: true } | { ok: false; error: DemoError | "bad_origin" | "too_many" }> {
  const id = idSchema.safeParse(demoId);
  if (!id.success) return { ok: false, error: "not_found" };
  const origin = normaliseOrigin(rawOrigin);
  if (!origin) return { ok: false, error: "bad_origin" };
  const { data: demo } = await supabase.from("demos").select("workspace_id").eq("id", id.data).maybeSingle();
  if (!demo) return { ok: false, error: "not_found" };
  const { error } = await supabase.from("demo_embed_origins").insert({ demo_id: id.data, workspace_id: demo.workspace_id, origin });
  if (!error || error.code === "23505") return { ok: true };
  return { ok: false, error: error.code === "54000" ? "too_many" : error.code === "42501" ? "forbidden" : "failed" };
}

export async function removeEmbedOrigin(supabase: SupabaseClient, demoId: unknown, originId: unknown): Promise<{ ok: true } | { ok: false; error: DemoError }> {
  const ids = z.object({ demo: idSchema, origin: idSchema }).safeParse({ demo: demoId, origin: originId });
  if (!ids.success) return { ok: false, error: "not_found" };
  const { error } = await supabase.from("demo_embed_origins").delete().eq("id", ids.data.origin).eq("demo_id", ids.data.demo);
  return error ? { ok: false, error: "failed" } : { ok: true };
}

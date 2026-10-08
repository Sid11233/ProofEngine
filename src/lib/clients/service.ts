import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fieldErrorsOf, type FieldErrors } from "@/lib/validation/form";
import { clientSchema, feedbackSchema, idSchema, linkSchema, projectSchema } from "./schemas";

// The server side of the Clients and Projects screens. `supabase` is always the user's own client, so row level
// security (member read, editor write, admin delete) has the last word; these functions add strict validation.

export type ClientsError = "invalid" | "not_found" | "forbidden" | "limit" | "failed";
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: ClientsError; fieldErrors?: FieldErrors };

export const CLIENTS_MESSAGES: Record<ClientsError, string> = {
  invalid: "Please check the highlighted fields.",
  not_found: "That was not found.",
  forbidden: "You do not have permission to do that.",
  limit: "You have reached the limit for this project.",
  failed: "Something went wrong. Please try again.",
};

const fail = (code?: string): { ok: false; error: ClientsError } => ({ ok: false, error: code === "42501" ? "forbidden" : code === "54000" ? "limit" : "failed" });

function parse<S extends z.ZodType>(schema: S, raw: unknown): { ok: true; data: z.infer<S> } | { ok: false; error: "invalid"; fieldErrors: FieldErrors } {
  const result = schema.safeParse(raw);
  return result.success ? { ok: true, data: result.data } : { ok: false, error: "invalid", fieldErrors: fieldErrorsOf(result.error) };
}

/** Optional fields that were left empty must clear the column on update, so undefined becomes null. */
const nullable = (data: Record<string, unknown>, optional: readonly string[] = []) => ({ ...Object.fromEntries(optional.map((k) => [k, null])), ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) });

const CLIENT_OPTIONAL = ["contact_name", "contact_email", "website_url", "notes"] as const;
const PROJECT_OPTIONAL = ["summary", "website_url", "repo_url", "notes", "started_on", "delivered_on"] as const;

export async function createClientRecord(supabase: SupabaseClient, ctx: { workspaceId: string; userId: string }, raw: unknown): Promise<Result<{ id: string }>> {
  const p = parse(clientSchema, raw);
  if (!p.ok) return p;
  const { data, error } = await supabase.from("clients").insert({ ...nullable(p.data), workspace_id: ctx.workspaceId, created_by: ctx.userId }).select("id").single();
  return error || !data ? fail(error?.code) : { ok: true, id: String(data.id) };
}

export async function updateClientRecord(supabase: SupabaseClient, id: unknown, raw: unknown): Promise<Result> {
  const key = idSchema.safeParse(id);
  if (!key.success) return { ok: false, error: "not_found" };
  const p = parse(clientSchema, raw);
  if (!p.ok) return p;
  const { data, error } = await supabase.from("clients").update(nullable(p.data, CLIENT_OPTIONAL)).eq("id", key.data).select("id");
  return error ? fail(error.code) : data?.length ? { ok: true } : { ok: false, error: "not_found" };
}

export async function deleteClientRecord(supabase: SupabaseClient, id: unknown): Promise<Result> {
  const key = idSchema.safeParse(id);
  if (!key.success) return { ok: false, error: "not_found" };
  const { data, error } = await supabase.from("clients").delete().eq("id", key.data).select("id");
  return error ? fail(error.code) : data?.length ? { ok: true } : { ok: false, error: "not_found" };
}

export async function createProjectRecord(supabase: SupabaseClient, ctx: { workspaceId: string; userId: string }, clientId: unknown, raw: unknown): Promise<Result<{ id: string }>> {
  const client = idSchema.safeParse(clientId);
  if (!client.success) return { ok: false, error: "not_found" };
  const p = parse(projectSchema, raw);
  if (!p.ok) return p;
  const { data, error } = await supabase.from("projects").insert({ ...nullable(p.data), client_id: client.data, workspace_id: ctx.workspaceId, created_by: ctx.userId }).select("id").single();
  // A client of another workspace fails the composite foreign key (23503).
  return error || !data ? (error?.code === "23503" ? { ok: false, error: "not_found" } : fail(error?.code)) : { ok: true, id: String(data.id) };
}

export async function updateProjectRecord(supabase: SupabaseClient, id: unknown, raw: unknown): Promise<Result> {
  const key = idSchema.safeParse(id);
  if (!key.success) return { ok: false, error: "not_found" };
  const p = parse(projectSchema, raw);
  if (!p.ok) return p;
  const { data, error } = await supabase.from("projects").update(nullable(p.data, PROJECT_OPTIONAL)).eq("id", key.data).select("id");
  return error ? fail(error.code) : data?.length ? { ok: true } : { ok: false, error: "not_found" };
}

export async function deleteProjectRecord(supabase: SupabaseClient, id: unknown): Promise<Result> {
  const key = idSchema.safeParse(id);
  if (!key.success) return { ok: false, error: "not_found" };
  const { data, error } = await supabase.from("projects").delete().eq("id", key.data).select("id");
  return error ? fail(error.code) : data?.length ? { ok: true } : { ok: false, error: "not_found" };
}

async function addChild(supabase: SupabaseClient, table: "project_links" | "project_feedback", ctx: { workspaceId: string; userId: string }, projectId: unknown, values: Record<string, unknown>): Promise<Result> {
  const project = idSchema.safeParse(projectId);
  if (!project.success) return { ok: false, error: "not_found" };
  const row = table === "project_feedback" ? { ...values, created_by: ctx.userId } : values;
  const { error } = await supabase.from(table).insert({ ...nullable(row), project_id: project.data, workspace_id: ctx.workspaceId });
  return error ? (error.code === "23503" ? { ok: false, error: "not_found" } : fail(error.code)) : { ok: true };
}

export async function addProjectLink(supabase: SupabaseClient, ctx: { workspaceId: string; userId: string }, projectId: unknown, raw: unknown): Promise<Result> {
  const p = parse(linkSchema, raw);
  return p.ok ? addChild(supabase, "project_links", ctx, projectId, p.data) : p;
}

export async function addProjectFeedback(supabase: SupabaseClient, ctx: { workspaceId: string; userId: string }, projectId: unknown, raw: unknown): Promise<Result> {
  const p = parse(feedbackSchema, raw);
  return p.ok ? addChild(supabase, "project_feedback", ctx, projectId, p.data) : p;
}

export async function removeProjectChild(supabase: SupabaseClient, table: "project_links" | "project_feedback", projectId: unknown, id: unknown): Promise<Result> {
  const ids = z.object({ project: idSchema, id: idSchema }).safeParse({ project: projectId, id });
  if (!ids.success) return { ok: false, error: "not_found" };
  const { data, error } = await supabase.from(table).delete().eq("id", ids.data.id).eq("project_id", ids.data.project).select("id");
  return error ? fail(error.code) : data?.length ? { ok: true } : { ok: false, error: "not_found" };
}

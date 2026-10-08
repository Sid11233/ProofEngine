"use server";

import "server-only";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import * as records from "@/lib/clients/service";
import { CLIENTS_MESSAGES, type ClientsError } from "@/lib/clients/service";
import { getClientIp } from "@/lib/security/client-ip";
import { createClient } from "@/lib/supabase/server";
import { formDataToObject, type FieldErrors } from "@/lib/validation/form";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export interface RecordResult {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
}

const CLIENT_KEYS = ["name", "contact_name", "contact_email", "website_url", "status", "notes"] as const;
const PROJECT_KEYS = ["name", "summary", "key_facts", "status", "website_url", "repo_url", "notes", "started_on", "delivered_on"] as const;
const LINK_KEYS = ["label", "url", "kind"] as const;
const FEEDBACK_KEYS = ["source", "author_name", "body"] as const;

const fail = (error: ClientsError | "throttled", fieldErrors?: FieldErrors): RecordResult => ({ ok: false, message: error === "throttled" ? RATE_LIMITED_MESSAGE : CLIENTS_MESSAGES[error], fieldErrors });
const idOf = (formData: FormData, key: string) => String(formData.get(key) ?? "");

/** Signed in, editor or above in the caller's own workspace (from the server, never the request), rate limited. */
async function authorise(minimum: "editor" | "admin" = "editor") {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace || workspace.role === "viewer") return "forbidden" as const;
  if (minimum === "admin" && workspace.role !== "owner" && workspace.role !== "admin") return "forbidden" as const;
  if (!(await isAuthAttemptAllowed("clients", { ip: getClientIp(await headers()), subject: user.id }))) return "throttled" as const;
  return { user, workspace, ctx: { workspaceId: workspace.id, userId: user.id } };
}

const done = (paths: string[], message: string): RecordResult => {
  for (const p of paths) revalidatePath(p);
  return { ok: true, message };
};

export async function createClientAction(_prev: RecordResult, formData: FormData): Promise<RecordResult> {
  const auth = await authorise();
  if (typeof auth === "string") return fail(auth);
  const result = await records.createClientRecord(await createClient(), auth.ctx, formDataToObject(formData, CLIENT_KEYS));
  if (!result.ok) return fail(result.error, result.fieldErrors);
  revalidatePath("/app/clients");
  redirect(`/app/clients/${result.id}`);
}

export async function updateClientAction(_prev: RecordResult, formData: FormData): Promise<RecordResult> {
  const auth = await authorise();
  if (typeof auth === "string") return fail(auth);
  const id = idOf(formData, "id");
  const result = await records.updateClientRecord(await createClient(), id, formDataToObject(formData, CLIENT_KEYS));
  return result.ok ? done(["/app/clients", `/app/clients/${id}`], "Saved.") : fail(result.error, result.fieldErrors);
}

export async function deleteClientAction(id: string): Promise<RecordResult> {
  const auth = await authorise("admin");
  if (typeof auth === "string") return fail(auth);
  const result = await records.deleteClientRecord(await createClient(), id);
  if (!result.ok) return fail(result.error);
  revalidatePath("/app/clients");
  revalidatePath("/app/projects");
  return { ok: true };
}

export async function createProjectAction(_prev: RecordResult, formData: FormData): Promise<RecordResult> {
  const auth = await authorise();
  if (typeof auth === "string") return fail(auth);
  const clientId = idOf(formData, "client_id");
  const result = await records.createProjectRecord(await createClient(), auth.ctx, clientId, formDataToObject(formData, PROJECT_KEYS));
  if (!result.ok) return fail(result.error, result.fieldErrors);
  revalidatePath("/app/projects");
  revalidatePath(`/app/clients/${clientId}`);
  redirect(`/app/projects/${result.id}`);
}

export async function updateProjectAction(_prev: RecordResult, formData: FormData): Promise<RecordResult> {
  const auth = await authorise();
  if (typeof auth === "string") return fail(auth);
  const id = idOf(formData, "id");
  const result = await records.updateProjectRecord(await createClient(), id, formDataToObject(formData, PROJECT_KEYS));
  return result.ok ? done(["/app/projects", `/app/projects/${id}`], "Saved.") : fail(result.error, result.fieldErrors);
}

export async function deleteProjectAction(id: string): Promise<RecordResult> {
  const auth = await authorise("admin");
  if (typeof auth === "string") return fail(auth);
  const result = await records.deleteProjectRecord(await createClient(), id);
  if (!result.ok) return fail(result.error);
  revalidatePath("/app/projects");
  revalidatePath("/app/clients");
  return { ok: true };
}

export async function addLinkAction(_prev: RecordResult, formData: FormData): Promise<RecordResult> {
  const auth = await authorise();
  if (typeof auth === "string") return fail(auth);
  const projectId = idOf(formData, "project_id");
  const result = await records.addProjectLink(await createClient(), auth.ctx, projectId, formDataToObject(formData, LINK_KEYS));
  return result.ok ? done([`/app/projects/${projectId}`], "Link added.") : fail(result.error, result.fieldErrors);
}

export async function addFeedbackAction(_prev: RecordResult, formData: FormData): Promise<RecordResult> {
  const auth = await authorise();
  if (typeof auth === "string") return fail(auth);
  const projectId = idOf(formData, "project_id");
  const result = await records.addProjectFeedback(await createClient(), auth.ctx, projectId, formDataToObject(formData, FEEDBACK_KEYS));
  return result.ok ? done([`/app/projects/${projectId}`], "Feedback added.") : fail(result.error, result.fieldErrors);
}

const table = z.enum(["project_links", "project_feedback"]);

export async function removeProjectChildAction(kind: string, projectId: string, id: string): Promise<RecordResult> {
  const auth = await authorise();
  if (typeof auth === "string") return fail(auth);
  const t = table.safeParse(kind);
  if (!t.success) return fail("not_found");
  const result = await records.removeProjectChild(await createClient(), t.data, projectId, id);
  return result.ok ? done([`/app/projects/${projectId}`], "Removed.") : fail(result.error);
}

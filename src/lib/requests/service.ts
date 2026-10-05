import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSender } from "@/lib/email/types";
import { generateToken } from "@/lib/security/tokens";
import { classify, type TeamError } from "@/lib/team/service";
import type { CreateRequestInput } from "./schemas";
import { focusOutcomesOf } from "./schemas";

// Proof request operations over the caller's own Supabase client: the database
// functions decide who may do what, enforce the plan limit and write the audit log.
// The raw token exists only in the return value and the email, never in storage.

export type RequestError = TeamError;

export const REQUEST_ERROR_MESSAGES: Record<RequestError, string> = {
  forbidden: "You do not have permission to do that.",
  conflict: "That request already exists.",
  limit: "A limit was reached: monthly interviews on your plan, 3 reminders per request, or 48 hours between reminders.",
  not_found: "That request could not be found.",
  invalid: "That is not possible in the request's current state.",
  failed: "Something went wrong. Please try again.",
};

export type RequestOutcome<T = object> = ({ ok: true } & T) | { ok: false; error: RequestError };

export interface LinkResult {
  /** Shown once to the owner. Not recoverable afterwards: use "new link" for another. */
  link: string;
  emailSent: boolean;
  requestId: string;
}

export interface RequestSummary {
  id: string;
  clientName: string;
  clientEmail: string;
  projectType: string | null;
  flowType: string;
  status: string;
  expiresAt: string;
  revokedAt: string | null;
  reminderCount: number;
  createdAt: string;
}

export interface Context {
  appUrl: string;
  workspaceName: string;
  sender: EmailSender | null;
  /** Link that stops further emails about one request. Included in every email to the client. */
  unsubscribeUrl?: (requestId: string) => string;
}

export const buildInterviewLink = (appUrl: string, rawToken: string) => new URL(`/i/${rawToken}`, appUrl).toString();

function inviteEmail(kind: "send" | "remind", { clientName, workspaceName, link, unsubscribe }: { clientName: string; workspaceName: string; link: string; unsubscribe?: string }) {
  const first = clientName.trim().split(/\s+/)[0] || "there";
  const intro =
    kind === "send"
      ? `${workspaceName} would love to hear about your experience. It takes about 3 minutes, and nothing is published without your approval.`
      : `A quick reminder: ${workspaceName} would love to hear about your experience. It takes about 3 minutes.`;
  return {
    subject: kind === "send" ? `${workspaceName} would like to hear from you` : `Reminder: ${workspaceName} would like to hear from you`,
    text: [
      `Hi ${first},`,
      "",
      intro,
      "",
      link,
      "",
      kind === "remind" ? "This link replaces the one in our earlier email." : "",
      "The link expires in 30 days. If you were not expecting this, you can ignore this email.",
      unsubscribe ? `Do not want these emails? Stop them here: ${unsubscribe}` : "",
    ]
      .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
      .join("\n"),
  };
}

async function loadForEmail(supabase: SupabaseClient, requestId: string) {
  const { data } = await supabase
    .from("proof_requests_safe")
    .select("client_name, client_email")
    .eq("id", requestId)
    .maybeSingle();
  return data ? { clientName: String(data.client_name), clientEmail: String(data.client_email) } : null;
}

async function rotateAndEmail(
  supabase: SupabaseClient,
  requestId: string,
  purpose: "send" | "remind" | "regenerate",
  ctx: Context,
): Promise<RequestOutcome<LinkResult>> {
  const token = generateToken();
  const { error } = await supabase.rpc("rotate_request_token", { request_id: requestId, new_hash: token.hash, purpose });
  if (error) return { ok: false, error: classify(error) };

  const link = buildInterviewLink(ctx.appUrl, token.raw);
  let emailSent = false;
  if (purpose !== "regenerate" && ctx.sender) {
    const recipient = await loadForEmail(supabase, requestId);
    if (recipient) {
      const message = inviteEmail(purpose, { clientName: recipient.clientName, workspaceName: ctx.workspaceName, link, unsubscribe: ctx.unsubscribeUrl?.(requestId) });
      emailSent = await ctx.sender.send({ to: recipient.clientEmail, ...message });
    }
  }
  return { ok: true, link, emailSent, requestId };
}

export async function createRequest(
  supabase: SupabaseClient,
  workspaceId: string,
  input: CreateRequestInput,
  ctx: Context,
): Promise<RequestOutcome<LinkResult>> {
  const token = generateToken();
  const { data, error } = await supabase.rpc("create_proof_request", {
    ws: workspaceId,
    client_name: input.clientName,
    client_email: input.clientEmail,
    project_type: input.projectType ?? null,
    flow_type: input.flowType,
    focus_outcomes: focusOutcomesOf(input),
    tone: input.tone,
    hash: token.hash,
  });
  if (error || typeof data !== "string") return { ok: false, error: error ? classify(error) : "failed" };

  // "Send now" issues a fresh token for the email, so the link we return and the one
  // that was emailed are the same one.
  if (input.sendNow) return rotateAndEmail(supabase, data, "send", ctx);
  return { ok: true, link: buildInterviewLink(ctx.appUrl, token.raw), emailSent: false, requestId: data };
}

export const sendInvite = (supabase: SupabaseClient, requestId: string, ctx: Context) =>
  rotateAndEmail(supabase, requestId, "send", ctx);
export const sendReminder = (supabase: SupabaseClient, requestId: string, ctx: Context) =>
  rotateAndEmail(supabase, requestId, "remind", ctx);
export const regenerateLink = (supabase: SupabaseClient, requestId: string, ctx: Context) =>
  rotateAndEmail(supabase, requestId, "regenerate", ctx);

export async function revokeRequest(supabase: SupabaseClient, requestId: string): Promise<RequestOutcome> {
  const { error } = await supabase.rpc("revoke_request", { request_id: requestId });
  return error ? { ok: false, error: classify(error) } : { ok: true };
}

const COLUMNS =
  "id, client_name, client_email, project_type, flow_type, status, expires_at, revoked_at, reminder_count, created_at";

const toSummary = (row: Record<string, unknown>): RequestSummary => ({
  id: String(row.id),
  clientName: String(row.client_name),
  clientEmail: String(row.client_email),
  projectType: typeof row.project_type === "string" ? row.project_type : null,
  flowType: String(row.flow_type),
  status: String(row.status),
  expiresAt: String(row.expires_at),
  revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
  reminderCount: Number(row.reminder_count ?? 0),
  createdAt: String(row.created_at),
});

export async function listRequests(supabase: SupabaseClient): Promise<RequestSummary[]> {
  // proof_requests_safe has no token_hash column; RLS still scopes it to the caller's workspaces.
  const { data } = await supabase.from("proof_requests_safe").select(COLUMNS).order("created_at", { ascending: false }).limit(200);
  return (data ?? []).map(toSummary);
}

export async function getRequest(supabase: SupabaseClient, id: string): Promise<RequestSummary | null> {
  const { data } = await supabase.from("proof_requests_safe").select(COLUMNS).eq("id", id).maybeSingle();
  return data ? toSummary(data) : null;
}

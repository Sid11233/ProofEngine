import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSender } from "@/lib/email/types";
import { generateToken } from "@/lib/security/tokens";
import { classify } from "@/lib/team/service";
import { slugify } from "./slug";

// Owner-side approval and publish operations over the caller's own Supabase client. The database
// functions decide who may do what and enforce every publish rule; this maps their answers to
// plain words. The raw approval token exists only in the return value and the email.

export interface ApprovalContext {
  appUrl: string;
  workspaceName: string;
  sender: EmailSender | null;
}

export const PUBLISH_BLOCK_MESSAGES: Record<string, string> = {
  disabled: "This page was switched off by the platform after a report and cannot be published.",
  declined: "The client declined this case study, so it cannot be published.",
  not_approved: "The client has not approved this exact version yet.",
  empty: "The case study has no content.",
  template_locked: "This template is not included in your plan. Choose a free template or upgrade.",
  bad_slug: "That page address is not allowed. Use 3 to 60 lowercase letters, numbers and single hyphens.",
  no_workspace_address: "Set your workspace address in settings before publishing.",
  claims_unconfirmed: "Some numbers or quotes are not confirmed by the client.",
};

/** The reason code in a trigger message such as "publish_blocked:not_approved", or null. */
export const publishBlockCode = (message: string | undefined) => /publish_blocked:([a-z_]+)/.exec(message ?? "")?.[1] ?? null;

export type ApprovalOutcome =
  | { ok: true; link: string; emailSent: boolean }
  | { ok: false; message: string };

export function approvalEmail({ clientName, workspaceName, link }: { clientName: string; workspaceName: string; link: string }) {
  const first = clientName.trim().split(/\s+/)[0] || "there";
  return {
    subject: `Please review your case study from ${workspaceName}`,
    text: [
      `Hi ${first},`,
      "",
      `${workspaceName} wrote a short case study from what you told them. Nothing is published unless you approve it, and you can ask for changes or say no.`,
      "",
      link,
      "",
      "The link works for 14 days and only for this version. If you were not expecting this, you can ignore this email.",
    ].join("\n"),
  };
}

async function approver(supabase: SupabaseClient, studyId: string) {
  const { data: study } = await supabase.from("case_studies").select("interview_id").eq("id", studyId).maybeSingle();
  if (!study?.interview_id) return null;
  const { data: interview } = await supabase.from("interviews").select("request_id").eq("id", study.interview_id).maybeSingle();
  if (!interview?.request_id) return null;
  const { data } = await supabase.from("proof_requests_safe").select("client_name, client_email").eq("id", interview.request_id).maybeSingle();
  return data ? { name: String(data.client_name), email: String(data.client_email) } : null;
}

export async function requestApproval(supabase: SupabaseClient, studyId: string, ctx: ApprovalContext): Promise<ApprovalOutcome> {
  const token = generateToken();
  const { error } = await supabase.rpc("request_client_approval", { study: studyId, hash: token.hash });
  if (error) {
    const kind = classify(error);
    return { ok: false, message: kind === "forbidden" ? "You do not have permission to do that." : kind === "invalid" ? "Approval can only be requested for a draft the client has not declined." : "We could not request approval." };
  }
  const link = new URL(`/approve/${token.raw}`, ctx.appUrl).toString();
  let emailSent = false;
  const recipient = ctx.sender ? await approver(supabase, studyId) : null;
  if (ctx.sender && recipient) {
    emailSent = await ctx.sender.send({ to: recipient.email, ...approvalEmail({ clientName: recipient.name, workspaceName: ctx.workspaceName, link }) });
  }
  return { ok: true, link, emailSent };
}

export async function publishStudy(supabase: SupabaseClient, studyId: string, slug: string | null, headline: string): Promise<{ ok: true; slug: string } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("publish_case_study", { study: studyId, new_slug: slug ?? slugify(headline) });
  if (!error && typeof data === "string") return { ok: true, slug: data };
  const code = publishBlockCode(error?.message);
  if (code) return { ok: false, message: PUBLISH_BLOCK_MESSAGES[code] ?? "It cannot be published yet." };
  if (error?.code === "23505") return { ok: false, message: "That page address is already used. Choose another." };
  if (error && classify(error) === "forbidden") return { ok: false, message: "Only admins and owners can publish." };
  return { ok: false, message: "We could not publish. Please try again." };
}

export async function unpublishStudy(supabase: SupabaseClient, studyId: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.rpc("unpublish_case_study", { study: studyId });
  if (!error) return { ok: true };
  return { ok: false, message: classify(error) === "forbidden" ? "Only admins and owners can unpublish." : "We could not unpublish." };
}

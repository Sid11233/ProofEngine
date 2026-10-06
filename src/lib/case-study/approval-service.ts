import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSender } from "@/lib/email/types";
import { generateToken } from "@/lib/security/tokens";
import { classify } from "@/lib/team/service";
import { verifyContent } from "./claim-check";
import { loadCaseStudy } from "./load";
import { slugify } from "./slug";

// Owner-side approval and publish operations over the caller's own Supabase client. The database
// functions decide who may do what and enforce every publish rule; this maps their answers to
// plain words. The raw approval token exists only in the return value and the email.

export interface ApprovalContext {
  appUrl: string;
  workspaceName: string;
  sender: EmailSender | null;
  /** The client's own "remove my story" link for a case study. */
  removalUrl?: (caseStudyId: string) => string;
}

export const PUBLISH_BLOCK_MESSAGES: Record<string, string> = {
  disabled: "This page was switched off by the platform after a report and cannot be published.",
  declined: "The client declined this case study, so it cannot be published.",
  not_approved: "The client has not approved this exact version yet.",
  not_signed: "The client has not signed this exact version yet.",
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

export function approvalEmail({ clientName, workspaceName, link, removalLink }: { clientName: string; workspaceName: string; link: string; removalLink?: string }) {
  const first = clientName.trim().split(/\s+/)[0] || "there";
  return {
    subject: `Please review and sign your case study from ${workspaceName}`,
    text: [
      `Hi ${first},`,
      "",
      `${workspaceName} wrote a short case study from what you told them. Nothing is published unless you review it and sign, and you can ask for changes or say no. We will email a short code to this address to confirm it is you.`,
      "",
      link,
      "",
      "The link works for 14 days and only for this version. If you were not expecting this, you can ignore this email.",
      ...(removalLink ? ["", `Prefer that none of this is kept? You can delete the story, your interview and your contact details at any time: ${removalLink}`] : []),
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

/**
 * Sending needs a draft whose numbers and quotes all point at something the client said. Numbers or quotes the owner
 * edited are allowed (the client sees them highlighted), but anything that points at no claim is not.
 */
export async function unverifiedContent(supabase: SupabaseClient, studyId: string): Promise<boolean> {
  const study = await loadCaseStudy(supabase, studyId);
  if (!study) return false;
  const refs = new Map(study.claims.map((c) => [c.id, c] as const));
  return verifyContent(study.content, refs).some((issue) => issue.kind === "unknown_claim" || issue.kind === "loose_number");
}

export async function requestApproval(supabase: SupabaseClient, studyId: string, ctx: ApprovalContext): Promise<ApprovalOutcome> {
  if (await unverifiedContent(supabase, studyId)) {
    return { ok: false, message: "Some numbers or quotes are not linked to what your client said. Fix or remove them first." };
  }
  const token = generateToken();
  const { error } = await supabase.rpc("request_client_approval", { study: studyId, hash: token.hash });
  if (error) {
    const kind = classify(error);
    return { ok: false, message: kind === "forbidden" ? "You do not have permission to do that." : kind === "invalid" ? "Approval can only be requested for a draft the client has not declined." : "We could not request approval." };
  }
  const link = new URL(`/sign/${token.raw}`, ctx.appUrl).toString();
  let emailSent = false;
  const recipient = ctx.sender ? await approver(supabase, studyId) : null;
  if (ctx.sender && recipient) {
    emailSent = await ctx.sender.send({ to: recipient.email, ...approvalEmail({ clientName: recipient.name, workspaceName: ctx.workspaceName, link, removalLink: ctx.removalUrl?.(studyId) }) });
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

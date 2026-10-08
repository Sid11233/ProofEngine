import type { SupabaseClient } from "@supabase/supabase-js";
import type { InterviewAccess } from "@/lib/interview-access-core";
import { hasClosing } from "./closing";
import type { FinishInput } from "./schemas";

export type FinishResult = { ok: true } | { ok: false; error: "closed" | "not_finished" | "invalid" | "failed" };

/** Records the publishing permission and referrals, then closes the interview and the link. */
export async function finishInterview(admin: SupabaseClient, access: InterviewAccess, input: FinishInput): Promise<FinishResult> {
  if (!access.interviewId) return { ok: false, error: "closed" };

  // Onboarding has no publishing, no referrals and no rating: the answers are only for the business.
  const onboarding = access.purpose === "onboarding";
  const permission = onboarding ? "anonymous" : input.publishPermission;
  if (!permission) return { ok: false, error: "invalid" };

  // Close first: this fails if the interview is not complete, so no referrals are stored for an unfinished one.
  const { error } = await admin.rpc("finish_interview", {
    intr: access.interviewId,
    ws: access.workspaceId,
    permission,
    total_questions: access.view.questions.length,
  });
  if (error) return { ok: false, error: error.code === "22023" ? "not_finished" : error.code === "P0002" ? "closed" : "failed" };

  if (!onboarding && input.referrals.length > 0) {
    // Referrals are stored but never emailed: the person referred is not contacted on the client's behalf.
    await admin.from("referrals").insert(
      input.referrals.map((r) => ({
        workspace_id: access.workspaceId,
        interview_id: access.interviewId,
        referred_name: r.name,
        referred_contact: r.contact,
      })),
    );
  }
  // Feedback and contact details are optional and best effort: the interview is already finished.
  if (!onboarding && hasClosing(input.closing)) {
    await admin.from("interview_closing").insert({
      workspace_id: access.workspaceId,
      interview_id: access.interviewId,
      rating: input.closing.rating ?? null,
      comment: input.closing.comment ?? null,
      contact_email: input.closing.email ?? null,
      contact_phone: input.closing.phone ?? null,
      company: input.closing.company ?? null,
      job_title: input.closing.jobTitle ?? null,
    });
  }
  return { ok: true };
}

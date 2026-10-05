import type { SupabaseClient } from "@supabase/supabase-js";
import type { InterviewAccess } from "@/lib/interview-access-core";
import type { FinishInput } from "./schemas";

export type FinishResult = { ok: true } | { ok: false; error: "closed" | "not_finished" | "failed" };

/** Records the publishing permission and referrals, then closes the interview and the link. */
export async function finishInterview(admin: SupabaseClient, access: InterviewAccess, input: FinishInput): Promise<FinishResult> {
  if (!access.interviewId) return { ok: false, error: "closed" };

  // Close first: this fails if the interview is not complete, so no referrals are stored for an unfinished one.
  const { error } = await admin.rpc("finish_interview", {
    intr: access.interviewId,
    ws: access.workspaceId,
    permission: input.publishPermission,
    total_questions: access.view.questions.length,
  });
  if (error) return { ok: false, error: error.code === "22023" ? "not_finished" : error.code === "P0002" ? "closed" : "failed" };

  if (input.referrals.length > 0) {
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
  return { ok: true };
}

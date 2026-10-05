import "server-only";
import { loadTranscript, type Progress } from "@/lib/ai/interviewer";
import type { InterviewAccess } from "@/lib/interview-access-core";
import { createAdminClient } from "@/lib/supabase/admin";

export interface InitialInterviewState {
  messages: Array<{ role: "client" | "bot"; content: string }>;
  progress: Progress;
  done: boolean;
}

/** Transcript for a returning client; null before the interview has started. */
export async function loadInitialState(access: InterviewAccess): Promise<InitialInterviewState | null> {
  if (!access.interviewId) return null;
  return loadTranscript(createAdminClient(), access.interviewId, access.workspaceId, access.view.questions.length);
}

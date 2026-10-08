import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InterviewAccess } from "@/lib/interview-access-core";
import type { UploadStore } from "@/lib/uploads/store";

// Voice answers. The browser records, the server transcribes, the client reviews the text and sends it as a normal
// answer. The recording is kept 30 days in a private bucket so the business can listen, then deleted by the purge job.
// The type of the file is decided from its bytes, never from the browser's label.

export * from "./voice-constants";
import { MAX_VOICE_BYTES, MAX_VOICES_PER_INTERVIEW, VOICE_BUCKET, VOICE_CONSENT_VERSION } from "./voice-constants";

export type AudioMime = "audio/webm" | "audio/ogg" | "audio/mp4" | "audio/wav";
const EXTENSION: Record<AudioMime, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/wav": "wav" };

export function detectAudio(bytes: Uint8Array): AudioMime | null {
  const at = (sig: number[], offset = 0) => bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);
  if (at([0x1a, 0x45, 0xdf, 0xa3])) return "audio/webm"; // EBML (WebM, Matroska)
  if (at([0x4f, 0x67, 0x67, 0x53])) return "audio/ogg"; // OggS
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x41, 0x56, 0x45], 8)) return "audio/wav"; // RIFF....WAVE
  if (at([0x66, 0x74, 0x79, 0x70], 4)) return "audio/mp4"; // ....ftyp
  return null;
}

export type VoiceError = "closed" | "too_large" | "empty" | "bad_audio" | "limit_reached" | "transcribe_failed" | "failed";
export type VoiceResult = { ok: true; voiceId: string; text: string } | { ok: false; error: VoiceError };

export interface VoiceDeps {
  admin: SupabaseClient;
  store: UploadStore;
  transcribe: (bytes: Uint8Array, mime: AudioMime) => Promise<string>;
}

export const voicePath = (workspaceId: string, interviewId: string, mime: AudioMime) => `${workspaceId}/${interviewId}/${randomUUID()}.${EXTENSION[mime]}`;

/** Transcribes first (so a failed transcription stores nothing), then stores the file and records the row. */
export async function recordVoice(deps: VoiceDeps, access: InterviewAccess, bytes: Uint8Array): Promise<VoiceResult> {
  if (!access.interviewId) return { ok: false, error: "closed" };
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > MAX_VOICE_BYTES) return { ok: false, error: "too_large" };
  const mime = detectAudio(bytes);
  if (!mime) return { ok: false, error: "bad_audio" };

  const { count } = await deps.admin.from("interview_voice").select("id", { count: "exact", head: true }).eq("interview_id", access.interviewId).eq("workspace_id", access.workspaceId);
  if ((count ?? 0) >= MAX_VOICES_PER_INTERVIEW) return { ok: false, error: "limit_reached" };

  let text: string;
  try {
    text = await deps.transcribe(bytes, mime);
  } catch {
    return { ok: false, error: "transcribe_failed" };
  }

  const path = voicePath(access.workspaceId, access.interviewId, mime);
  if (!(await deps.store.put(path, bytes, mime))) return { ok: false, error: "failed" };
  const { data, error } = await deps.admin
    .from("interview_voice")
    .insert({
      workspace_id: access.workspaceId, interview_id: access.interviewId, file_path: path, mime_type: mime, size_bytes: bytes.length,
      consent_text_version: VOICE_CONSENT_VERSION, transcript_chars: text.length,
    })
    .select("id")
    .single();
  if (error || !data) {
    await deps.store.remove(path);
    return { ok: false, error: error?.code === "54000" ? "limit_reached" : "failed" };
  }
  return { ok: true, voiceId: String(data.id), text };
}

/** Ties a recording to the answer the client sent from it. Only this interview's own, still unattached recording counts. */
export async function attachVoice(admin: SupabaseClient, access: InterviewAccess, voiceId: string, messageId: string): Promise<void> {
  if (!access.interviewId) return;
  await admin.from("interview_voice").update({ message_id: messageId }).eq("id", voiceId).eq("interview_id", access.interviewId).eq("workspace_id", access.workspaceId).is("message_id", null);
}

/** Recordings past their 30 days: files first, then rows. A file that cannot be removed keeps its row for the next run. Returns how many were removed. */
export async function purgeExpiredVoice(admin: SupabaseClient, batch = 200): Promise<number> {
  const { data } = await admin.from("interview_voice").select("id, file_path").lt("expires_at", new Date().toISOString()).limit(batch);
  let removed = 0;
  for (const row of data ?? []) {
    const { error: fileError } = await admin.storage.from(VOICE_BUCKET).remove([String(row.file_path)]);
    if (fileError) continue;
    const { error } = await admin.from("interview_voice").delete().eq("id", row.id);
    if (!error) removed += 1;
  }
  return removed;
}

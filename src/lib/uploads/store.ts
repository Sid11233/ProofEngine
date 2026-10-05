import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const UPLOADS_BUCKET = "uploads";
export const SIGNED_URL_SECONDS = 60;

export interface UploadStore {
  put(path: string, data: Uint8Array, contentType: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  /** A short-lived link to read one file, or null if it does not exist. */
  signedUrl(path: string, seconds?: number): Promise<string | null>;
}

/** `{workspace_id}/{interview_id}/{uuid}.webp`: the original file name is never used. */
export const objectPath = (workspaceId: string, interviewId: string) => `${workspaceId}/${interviewId}/${randomUUID()}.webp`;

/** Private bucket, service role only. Files are served through short-lived signed URLs. */
export function createSupabaseStore(admin: SupabaseClient, bucket = UPLOADS_BUCKET): UploadStore {
  return {
    async put(path, data, contentType) {
      const { error } = await admin.storage.from(bucket).upload(path, data, { contentType, upsert: false });
      return !error;
    },
    async remove(path) {
      await admin.storage.from(bucket).remove([path]);
    },
    async signedUrl(path, seconds = SIGNED_URL_SECONDS) {
      const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, Math.min(seconds, 300));
      return error || !data ? null : data.signedUrl;
    },
  };
}

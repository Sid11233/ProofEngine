import type { SupabaseClient } from "@supabase/supabase-js";
import type { InterviewAccess } from "@/lib/interview-access-core";
import { reencodeToWebp } from "./process";
import { objectPath, type UploadStore } from "./store";
import { validateUpload, type UploadError } from "./validate";

export type UploadKind = "logo" | "headshot";
export type StoreUploadResult =
  | { ok: true; uploadId: string; sizeBytes: number }
  | { ok: false; error: UploadError | "closed" | "limit_reached" | "failed" };

/**
 * Validate, re-encode, store privately, then record. If recording fails (for example
 * the 4-file cap), the stored object is removed again so nothing is left orphaned.
 */
export async function storeInterviewUpload(
  deps: { admin: SupabaseClient; store: UploadStore },
  access: InterviewAccess,
  input: { kind: UploadKind; filename: string; bytes: Uint8Array },
): Promise<StoreUploadResult> {
  if (!access.interviewId) return { ok: false, error: "closed" };

  const checked = validateUpload(input.filename, input.bytes);
  if (!checked.ok) return checked;

  let image;
  try {
    image = await reencodeToWebp(input.bytes);
  } catch {
    // Passed the signature check but is not a decodable image (truncated, corrupt, or crafted).
    return { ok: false, error: "bad_content" };
  }

  const path = objectPath(access.workspaceId, access.interviewId);
  if (!(await deps.store.put(path, image.data, "image/webp"))) return { ok: false, error: "failed" };

  const { data, error } = await deps.admin.rpc("record_upload", {
    intr: access.interviewId, ws: access.workspaceId, path, upload_kind: input.kind, size: image.data.length,
  });
  if (error || typeof data !== "string") {
    await deps.store.remove(path);
    return { ok: false, error: error?.code === "54000" ? "limit_reached" : error?.code === "P0002" ? "closed" : "failed" };
  }
  return { ok: true, uploadId: data, sizeBytes: image.data.length };
}

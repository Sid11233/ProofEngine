import { randomUUID } from "node:crypto";
import { reencodeToWebp } from "./process";
import type { UploadStore } from "./store";
import { validateUpload, type UploadError } from "./validate";

export type LogoResult = { ok: true; path: string } | { ok: false; error: UploadError | "failed" };

/** `{workspace_id}/logos/{uuid}.webp`: the shape autosave_case_study() accepts. The file name is never used. */
export const logoPath = (workspaceId: string) => `${workspaceId}/logos/${randomUUID()}.webp`;

/**
 * A case study logo takes the same path as every other upload: type from the bytes (no SVG),
 * 2 MB cap, decoded and re-encoded to WebP (metadata and hidden payloads dropped), resized to
 * 1200px, stored privately. The caller has already checked who may upload.
 */
export async function storeLogo(store: UploadStore, workspaceId: string, input: { filename: string; bytes: Uint8Array }): Promise<LogoResult> {
  const checked = validateUpload(input.filename, input.bytes);
  if (!checked.ok) return checked;
  let image;
  try {
    image = await reencodeToWebp(input.bytes);
  } catch {
    return { ok: false, error: "bad_content" };
  }
  const path = logoPath(workspaceId);
  return (await store.put(path, image.data, "image/webp")) ? { ok: true, path } : { ok: false, error: "failed" };
}

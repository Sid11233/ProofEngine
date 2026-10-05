// Server-side upload checks. The browser's MIME type and the file name are never trusted:
// the type is decided from the file's own bytes, and only png, jpeg and webp are accepted.
// SVG (which can carry script) and everything else is refused.

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;

export type ImageType = "png" | "jpeg" | "webp";
export type UploadError = "too_large" | "empty" | "bad_extension" | "bad_content";

export function detectImageType(bytes: Uint8Array): ImageType | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (bytes.length >= 8 && startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (bytes.length >= 3 && startsWith([0xff, 0xd8, 0xff])) return "jpeg";
  // RIFF....WEBP
  if (bytes.length >= 12 && startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  return null;
}

export function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

export function validateUpload(filename: string, bytes: Uint8Array): { ok: true; type: ImageType } | { ok: false; error: UploadError } {
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: "too_large" };
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(extensionOf(filename))) return { ok: false, error: "bad_extension" };
  const type = detectImageType(bytes);
  return type ? { ok: true, type } : { ok: false, error: "bad_content" };
}

import sharp from "sharp";

export const MAX_SIGNATURE_BYTES = 200 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SIDE = 1600;

export type SignatureImageResult = { ok: true; png: Buffer } | { ok: false; reason: "too_large" | "not_png" | "invalid" };

/** Accepts a drawn signature only if it really is a small PNG, then re-encodes it so no metadata or hidden data survives. */
export async function cleanSignatureImage(input: Buffer): Promise<SignatureImageResult> {
  if (input.length > MAX_SIGNATURE_BYTES) return { ok: false, reason: "too_large" };
  if (input.length < PNG_MAGIC.length || !input.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return { ok: false, reason: "not_png" };
  try {
    const image = sharp(input, { limitInputPixels: MAX_SIDE * MAX_SIDE, failOn: "error" });
    const meta = await image.metadata();
    if (meta.format !== "png" || !meta.width || !meta.height || meta.width > MAX_SIDE || meta.height > MAX_SIDE) return { ok: false, reason: "invalid" };
    const png = await image.png({ compressionLevel: 9 }).toBuffer();
    return { ok: true, png };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

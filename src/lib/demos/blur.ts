import sharp, { type OverlayOptions } from "sharp";
import type { Rect } from "./schema";

const BLOCK = 14; // pixels per block in the pixelated area

/**
 * Burns a pixelation into the image itself, so the original pixels are gone from the file that is served.
 * (The player's CSS blur is only cosmetic; this is the real redaction.) Rectangles are fractions of the image.
 */
export async function pixelateRegions(webp: Uint8Array, regions: Rect[]): Promise<{ data: Buffer; width: number; height: number }> {
  const base = sharp(webp);
  const { width, height } = await base.metadata();
  if (!width || !height) throw new Error("unreadable image");
  const overlays: OverlayOptions[] = [];
  for (const r of regions) {
    const left = Math.max(0, Math.floor(r.x * width));
    const top = Math.max(0, Math.floor(r.y * height));
    const w = Math.min(width - left, Math.max(1, Math.ceil(r.w * width)));
    const h = Math.min(height - top, Math.max(1, Math.ceil(r.h * height)));
    const small = await sharp(webp)
      .extract({ left, top, width: w, height: h })
      .resize(Math.max(1, Math.round(w / BLOCK)), Math.max(1, Math.round(h / BLOCK)), { kernel: "nearest" })
      .toBuffer();
    const block = await sharp(small).resize(w, h, { kernel: "nearest" }).png().toBuffer();
    overlays.push({ input: block, left, top });
  }
  const { data, info } = await sharp(webp).composite(overlays).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

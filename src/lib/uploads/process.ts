import sharp from "sharp";

export const MAX_DIMENSION = 1200;
// Guards against decompression bombs: a tiny file that expands to a gigantic bitmap.
const MAX_INPUT_PIXELS = 24_000_000;

/**
 * Decodes the image and writes a brand-new WebP, so EXIF/GPS data, embedded profiles and
 * any payload hidden in metadata or trailing bytes are dropped. Resized to fit 1200px.
 * Throws if the bytes are not a decodable image.
 */
export async function reencodeToWebp(bytes: Uint8Array, maxDimension = MAX_DIMENSION): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false })
    .rotate() // apply EXIF orientation first, since the metadata is about to go
    .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_DIMENSION, reencodeToWebp } from "./process";
import { detectImageType } from "./validate";

const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } });

describe("reencodeToWebp", () => {
  it("produces a WebP whatever the input format was", async () => {
    for (const make of [() => solid(40, 40).png().toBuffer(), () => solid(40, 40).jpeg().toBuffer(), () => solid(40, 40).webp().toBuffer()]) {
      const out = await reencodeToWebp(await make());
      expect(detectImageType(out.data)).toBe("webp");
    }
  });

  it("strips EXIF and GPS metadata", async () => {
    const withExif = await solid(60, 60)
      .jpeg()
      .withExif({ IFD0: { Copyright: "SECRET-COPYRIGHT-STRING", Artist: "secret-artist" } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif, "test image should carry EXIF").toBeDefined();
    expect(withExif.includes(Buffer.from("SECRET-COPYRIGHT-STRING"))).toBe(true);

    const out = await reencodeToWebp(withExif);
    expect(out.data.includes(Buffer.from("SECRET-COPYRIGHT-STRING"))).toBe(false);
    expect(out.data.includes(Buffer.from("secret-artist"))).toBe(false);
    expect((await sharp(out.data).metadata()).exif).toBeUndefined();
  });

  it("drops a payload hidden after the image data", async () => {
    const jpeg = await solid(50, 50).jpeg().toBuffer();
    const smuggled = Buffer.concat([jpeg, Buffer.from("<script>alert('payload')</script>MZ-evil-binary")]);
    expect((await reencodeToWebp(smuggled)).data.includes(Buffer.from("payload"))).toBe(false);
  });

  it("resizes large images to fit within 1200px, keeping the aspect ratio, and never enlarges", async () => {
    const big = await reencodeToWebp(await solid(3000, 1500).png().toBuffer());
    expect(Math.max(big.width, big.height)).toBe(MAX_DIMENSION);
    expect(big.width / big.height).toBeCloseTo(2, 1);
    const small = await reencodeToWebp(await solid(100, 80).png().toBuffer());
    expect(small).toMatchObject({ width: 100, height: 80 });
  });

  it("applies EXIF orientation before dropping it, so photos are not left sideways", async () => {
    const tall = await solid(40, 100).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await reencodeToWebp(tall);
    expect(out.width).toBeGreaterThan(out.height);
  });

  it.each([
    ["a truncated png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(30, 7)])],
    ["a jpeg header with garbage", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)])],
    ["random bytes", Buffer.alloc(500, 9)],
  ])("rejects %s", async (_label, bytes) => {
    await expect(reencodeToWebp(bytes)).rejects.toThrow();
  });

  it("refuses a decompression bomb (huge pixel dimensions in a tiny file)", async () => {
    const bomb = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(200_000); // tiny on disk, 36 million pixels decoded
    await expect(reencodeToWebp(bomb)).rejects.toThrow();
  });
});

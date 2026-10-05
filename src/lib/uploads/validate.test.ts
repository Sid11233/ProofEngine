import { describe, expect, it } from "vitest";
import { detectImageType, extensionOf, MAX_UPLOAD_BYTES, validateUpload } from "./validate";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0, 0x04, 0, 0, 0]); // "MZ" Windows executable
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
const gif = new TextEncoder().encode("GIF89a\x01\x00\x01\x00");

describe("detectImageType", () => {
  it("recognises png, jpeg and webp by their bytes", () => {
    expect(detectImageType(png)).toBe("png");
    expect(detectImageType(jpeg)).toBe("jpeg");
    expect(detectImageType(webp)).toBe("webp");
  });

  it.each([["an executable", exe], ["svg", svg], ["html", html], ["gif", gif], ["empty", new Uint8Array()], ["a short riff header", Uint8Array.from([0x52, 0x49, 0x46, 0x46])]])(
    "does not accept %s",
    (_label, bytes) => expect(detectImageType(bytes)).toBeNull(),
  );

  it("does not accept RIFF files that are not WebP (e.g. WAV)", () => {
    const wav = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]);
    expect(detectImageType(wav)).toBeNull();
  });
});

describe("extensionOf", () => {
  it.each([["a.PNG", "png"], ["photo.final.JpG", "jpg"], ["noext", ""], ["trailing.", ""], ["../../x.webp", "webp"], ["evil.png.exe", "exe"]])("%j -> %j", (name, ext) => {
    expect(extensionOf(name)).toBe(ext);
  });
});

describe("validateUpload", () => {
  it("accepts a real image with a matching extension", () => {
    expect(validateUpload("logo.png", png)).toEqual({ ok: true, type: "png" });
    expect(validateUpload("me.JPEG", jpeg)).toEqual({ ok: true, type: "jpeg" });
    expect(validateUpload("pic.webp", webp)).toEqual({ ok: true, type: "webp" });
  });

  it("rejects a renamed .exe, whatever it is called", () => {
    expect(validateUpload("logo.png", exe)).toEqual({ ok: false, error: "bad_content" });
    expect(validateUpload("logo.jpg", exe)).toEqual({ ok: false, error: "bad_content" });
    expect(validateUpload("installer.exe", exe)).toEqual({ ok: false, error: "bad_extension" });
  });

  it("rejects SVG both ways: by extension and when disguised", () => {
    expect(validateUpload("logo.svg", svg)).toEqual({ ok: false, error: "bad_extension" });
    expect(validateUpload("logo.png", svg)).toEqual({ ok: false, error: "bad_content" });
  });

  it("rejects html, gif, and unknown extensions", () => {
    expect(validateUpload("page.png", html)).toEqual({ ok: false, error: "bad_content" });
    expect(validateUpload("anim.gif", gif)).toEqual({ ok: false, error: "bad_extension" });
    expect(validateUpload("noext", png)).toEqual({ ok: false, error: "bad_extension" });
    expect(validateUpload("double.png.exe", png)).toEqual({ ok: false, error: "bad_extension" });
  });

  it("rejects empty and oversized files", () => {
    expect(validateUpload("a.png", new Uint8Array())).toEqual({ ok: false, error: "empty" });
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(png);
    expect(validateUpload("a.png", big)).toEqual({ ok: false, error: "too_large" });
    const exact = new Uint8Array(MAX_UPLOAD_BYTES);
    exact.set(png);
    expect(validateUpload("a.png", exact).ok).toBe(true);
  });
});

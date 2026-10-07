import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { blurDemoAsset, demoAssetPath, storeDemoAsset, validateDemoUpload } from "./assets";
import { pixelateRegions } from "./blur";

const WS = "11111111-1111-4111-8111-111111111111";
const DEMO = "22222222-2222-4222-8222-222222222222";

const png = (w = 200, h = 100) => sharp({ create: { width: w, height: h, channels: 3, background: "#336699" } }).png().toBuffer();

function fakes(insertError?: { code: string }) {
  const files = new Map<string, Uint8Array>();
  const rows: Array<Record<string, unknown>> = [];
  const store = {
    put: async (p: string, d: Uint8Array) => (files.set(p, d), true),
    remove: async (p: string) => void files.delete(p),
    signedUrl: async () => null,
  };
  const admin = {
    from: () => ({
      insert: (row: Record<string, unknown>) => ({ select: () => ({ single: async () => (insertError ? { data: null, error: insertError } : (rows.push(row), { data: { id: "asset-1" }, error: null })) }) }),
    }),
  };
  return { files, rows, store, admin: admin as never };
}

describe("validateDemoUpload", () => {
  it("accepts up to 5 MB of real images only", async () => {
    expect(validateDemoUpload("a.png", await png())).toEqual({ ok: true });
    expect(validateDemoUpload("a.png", new Uint8Array(0))).toEqual({ ok: false, error: "empty" });
    expect(validateDemoUpload("a.png", new Uint8Array(5 * 1024 * 1024 + 1))).toEqual({ ok: false, error: "too_large" });
    expect(validateDemoUpload("a.svg", await png())).toEqual({ ok: false, error: "bad_extension" });
    expect(validateDemoUpload("a.png", new TextEncoder().encode("<svg onload=alert(1)>"))).toEqual({ ok: false, error: "bad_content" });
  });
});

describe("storeDemoAsset", () => {
  it("re-encodes to webp, stores under the demo path, and records the image as flagged", async () => {
    const f = fakes();
    const r = await storeDemoAsset({ admin: f.admin, store: f.store }, { workspaceId: WS, demoId: DEMO }, { filename: "../../evil.png", bytes: await png(), kind: "screenshot" });
    expect(r).toMatchObject({ ok: true, id: "asset-1", width: 200, height: 100 });
    const [path] = [...f.files.keys()];
    expect(path).toMatch(new RegExp(`^${WS}/${DEMO}/[0-9a-f-]{36}\\.webp$`));
    expect((await sharp(f.files.get(path)).metadata()).format).toBe("webp");
    expect(f.rows[0]).toMatchObject({ flagged: true, kind: "screenshot", workspace_id: WS, demo_id: DEMO });
    expect(f.rows[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("removes the file again when recording fails, and reports the image cap", async () => {
    const f = fakes({ code: "54000" });
    const r = await storeDemoAsset({ admin: f.admin, store: f.store }, { workspaceId: WS, demoId: DEMO }, { filename: "a.png", bytes: await png(), kind: "image" });
    expect(r).toEqual({ ok: false, error: "limit_reached" });
    expect(f.files.size).toBe(0);
  });
  it("refuses a truncated image that has a valid signature", async () => {
    const f = fakes();
    const bytes = (await png()).subarray(0, 40);
    expect(await storeDemoAsset({ admin: f.admin, store: f.store }, { workspaceId: WS, demoId: DEMO }, { filename: "a.png", bytes, kind: "image" })).toEqual({ ok: false, error: "bad_content" });
    expect(f.files.size).toBe(0);
  });
  it("builds paths from ids only", () => {
    expect(demoAssetPath(WS, DEMO)).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/);
  });
});

describe("pixelateRegions", () => {
  it("destroys the detail inside the box and leaves the rest alone", async () => {
    // left half black/white stripes, right half solid
    const stripes = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#ffffff" } })
      .composite(Array.from({ length: 50 }, (_, i) => ({ input: { create: { width: 2, height: 100, channels: 3 as const, background: "#000000" } }, left: i * 4, top: 0 })))
      .webp({ lossless: true }).toBuffer();
    const out = await pixelateRegions(stripes, [{ x: 0, y: 0, w: 0.5, h: 1 }]);
    const raw = (b: Buffer) => sharp(b).removeAlpha().raw().toBuffer();
    const before = await raw(stripes);
    const after = await raw(out.data);
    const px = (buf: Buffer, x: number, y = 10) => buf[(y * 200 + x) * 3];
    // inside: stripes at x=0 (black) and x=2 (white) are now the same value
    expect(px(before, 0)).not.toBe(px(before, 2));
    expect(Math.abs(px(after, 0) - px(after, 2))).toBeLessThan(5);
    // outside the box the stripes survive (lossless source, so allow small codec drift)
    expect(Math.abs(px(after, 150) - px(before, 150))).toBeLessThan(40);
    expect(out).toMatchObject({ width: 200, height: 100 });
  });
});

describe("blurDemoAsset", () => {
  it("swaps in the pixelated file, resolves the row and removes the old file", async () => {
    const files = new Map<string, Uint8Array>();
    const oldPath = demoAssetPath(WS, DEMO);
    files.set(oldPath, await sharp(await png()).webp().toBuffer());
    let updated: Record<string, unknown> | undefined;
    const admin = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { file_path: oldPath } }) }) }) }) }),
        update: (v: Record<string, unknown>) => ({ eq: async () => ((updated = v), { error: null }) }),
      }),
    } as never;
    const store = { put: async (p: string, d: Uint8Array) => (files.set(p, d), true), remove: async (p: string) => void files.delete(p), signedUrl: async () => null };
    const r = await blurDemoAsset({ admin, store, read: async (p) => files.get(p) ?? null }, { workspaceId: WS, demoId: DEMO, assetId: "a", userId: "u" }, [{ x: 0, y: 0, w: 0.5, h: 0.5 }]);
    expect(r).toEqual({ ok: true });
    expect(files.has(oldPath)).toBe(false);
    expect(files.size).toBe(1);
    expect(updated).toMatchObject({ flagged: false, resolution: "blurred", resolved_by: "u" });
    expect(updated?.file_path).toBe([...files.keys()][0]);
  });
});

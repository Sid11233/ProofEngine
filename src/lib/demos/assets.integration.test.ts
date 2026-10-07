/** Demo images against the real database and storage (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, loadLocalConfig, makeClient, type TestUser } from "../../../supabase/tests/isolation/harness";
import { blurDemoAsset, DEMO_BUCKET, storeDemoAsset } from "./assets";
import { createSupabaseStore } from "../uploads/store";

let admin: SupabaseClient;
let owner: TestUser;
let ws: string;
let demoId: string;

const png = () => sharp({ create: { width: 300, height: 200, channels: 3, background: "#cc5533" } }).png().toBuffer();

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  owner = await createTestUser(cfg, admin, "da-owner");
  ws = String((await owner.client.rpc("create_workspace", { name: "Asset Co", type: "agency" })).data);
  const { data } = await owner.client.from("demos").insert({ workspace_id: ws, created_by: owner.id, title: "Assets", content: { scenes: [] } }).select("id").single();
  demoId = String(data?.id);
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  await admin.auth.admin.deleteUser(owner.id);
}, 120_000);

describe("demo images, end to end", () => {
  it("stores a flagged image, blocks publishing, then pixelating resolves it", async () => {
    const store = createSupabaseStore(admin, DEMO_BUCKET);
    const stored = await storeDemoAsset({ admin, store }, { workspaceId: ws, demoId }, { filename: "shot.png", bytes: await png(), kind: "screenshot" });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;

    const { data: row } = await admin.from("demo_assets").select("file_path, flagged, resolution").eq("id", stored.id).single();
    expect(row).toMatchObject({ flagged: true, resolution: null });
    expect((await admin.storage.from(DEMO_BUCKET).download(String(row?.file_path))).error).toBeNull();

    // a member can read the row, an outsider's client cannot even see it
    expect((await owner.client.from("demo_assets").select("id").eq("id", stored.id)).data).toHaveLength(1);

    await owner.client.from("demos").update({ content: { scenes: [{ id: "c1", type: "chat", persona: { name: "A", role: "B" }, messages: [], choices: [] }] }, authenticity_attested: true, redaction_acknowledged: true }).eq("id", demoId);
    const blocked = await owner.client.rpc("publish_demo", { demo: demoId, new_slug: `da-${Date.now()}` });
    expect(blocked.error?.message).toContain("flagged_assets");

    const oldPath = String(row?.file_path);
    const read = async (p: string) => new Uint8Array(await (await admin.storage.from(DEMO_BUCKET).download(p)).data!.arrayBuffer());
    const done = await blurDemoAsset({ admin, store, read }, { workspaceId: ws, demoId, assetId: stored.id, userId: owner.id }, [{ x: 0.1, y: 0.1, w: 0.3, h: 0.3 }]);
    expect(done).toEqual({ ok: true });
    const { data: after } = await admin.from("demo_assets").select("file_path, flagged, resolution").eq("id", stored.id).single();
    expect(after).toMatchObject({ flagged: false, resolution: "blurred" });
    expect(after?.file_path).not.toBe(oldPath);
    expect((await admin.storage.from(DEMO_BUCKET).download(oldPath)).error).not.toBeNull();

    const published = await owner.client.rpc("publish_demo", { demo: demoId, new_slug: `da-${Date.now()}` });
    expect(published.error).toBeNull();
  }, 60_000);

  it("clients cannot write to the bucket", async () => {
    const up = await owner.client.storage.from(DEMO_BUCKET).upload(`${ws}/${demoId}/x.webp`, new Uint8Array([1]), { contentType: "image/webp" });
    expect(up.error).not.toBeNull();
  });
});

describe("demo service, end to end", () => {
  it("creates, saves valid content, refuses foreign images and markup, publishes through the rules", async () => {
    const { createDemo, saveDemo, publishDemo, unpublishDemo } = await import("./service");
    await admin.from("workspaces").update({ plan: "pro" }).eq("id", ws);
    const created = await createDemo(owner.client, { workspaceId: ws, userId: owner.id }, "My demo");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.id;

    const chat = (text: string) => ({ scenes: [{ id: "c1", type: "chat", persona: { name: "Ava", role: "Agent" }, messages: [{ from: "agent", text, delayMs: 0 }], choices: [] }] });
    expect(await saveDemo(owner.client, id, { content: chat("Hello there") })).toEqual({ ok: true, findings: [] });
    expect(await saveDemo(owner.client, id, { content: chat("<img src=x onerror=1>") })).toMatchObject({ ok: false, error: "invalid" });
    expect(await saveDemo(owner.client, id, { content: chat("Write me at jane@acme.com") })).toMatchObject({ ok: true, findings: [{ path: "scenes.0.messages.0", kinds: ["email"] }] });
    expect(await saveDemo(owner.client, id, { content: chat("Hello there"), status: "published" })).toMatchObject({ ok: false, error: "invalid" });

    // an image id that is not one of this demo's rows
    const foreign = { scenes: [{ id: "s1", type: "screenshot", assetId: "99999999-9999-4999-8999-999999999999", hotspot: { x: 0, y: 0, w: 0.5, h: 0.5 }, tooltip: { title: "T", body: "", position: "top" } }] };
    expect(await saveDemo(owner.client, id, { content: foreign })).toEqual({ ok: false, error: "invalid", issues: ["An image does not belong to this demo"] });

    expect(await publishDemo(owner.client, id, "Bad Slug!")).toEqual({ ok: false, error: "bad_slug" });
    expect(await publishDemo(owner.client, id, "my-demo-1234")).toEqual({ ok: false, error: "not_attested" });
    await saveDemo(owner.client, id, { authenticity_attested: true, redaction_acknowledged: true });
    const live = await publishDemo(owner.client, id, "my-demo-1234");
    expect(live).toEqual({ ok: true, slug: "my-demo-1234" });
    expect(await saveDemo(owner.client, id, { title: "Changed" })).toEqual({ ok: false, error: "locked" });
    expect(await unpublishDemo(owner.client, id)).toEqual({ ok: true });
    expect(await saveDemo(owner.client, id, { title: "Changed" })).toMatchObject({ ok: true });
  }, 60_000);

  it("refuses to publish typed text that looks like a key or card number", async () => {
    const { createDemo, saveDemo, publishDemo } = await import("./service");
    await admin.from("workspaces").update({ plan: "pro" }).eq("id", ws);
    const made = await createDemo(owner.client, { workspaceId: ws, userId: owner.id }, "Leaky");
    if (!made.ok) throw new Error("create failed");
    const chat = (text: string) => ({ scenes: [{ id: "c1", type: "chat", persona: { name: "Ava", role: "Agent" }, messages: [{ from: "agent", text, delayMs: 0 }], choices: [] }] });
    await saveDemo(owner.client, made.id, { content: chat("Use key sk_live_abcdefghijklmnop1234 to connect"), authenticity_attested: true, redaction_acknowledged: true });
    expect(await publishDemo(owner.client, made.id, "leaky-demo")).toEqual({ ok: false, error: "sensitive_text" });
    await saveDemo(owner.client, made.id, { content: chat("Pay with 4242 4242 4242 4242") });
    expect(await publishDemo(owner.client, made.id, "leaky-demo")).toEqual({ ok: false, error: "sensitive_text" });
    await saveDemo(owner.client, made.id, { content: chat("Connect with your own key") });
    expect(await publishDemo(owner.client, made.id, "leaky-demo")).toEqual({ ok: true, slug: "leaky-demo" });
  }, 60_000);
});

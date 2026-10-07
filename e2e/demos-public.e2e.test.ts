import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { PORT, createUser, startStack, stopStack, type Stack } from "./harness";

let stack: Stack;

beforeAll(async () => {
  stack = await startStack({ PUBLIC_SITES_DOMAIN: `localhost:${PORT}` });
}, 120_000);
afterAll(async () => {
  await stopStack(stack);
});

const site = (workspace: string, path = "/") => `http://${workspace}.localhost:${PORT}${path}`;
const ipHeader = () => ({ "x-forwarded-for": `198.51.100.${(Date.now() % 200) + 20}` });

async function liveDemo({ lead_gate = "none", allow_embed = false, origins = [] as string[], slug = "tour", publish = true } = {}) {
  const owner = await createUser(stack.admin, "dp");
  const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", owner.id).single();
  const ws = String(member?.workspace_id);
  const workspace = `dp-${randomBytes(4).toString("hex")}`;
  await stack.admin.from("workspaces").update({ plan: "pro", subdomain_slug: workspace, name: "Acme Studio" }).eq("id", ws);
  const { data: demo, error } = await stack.admin.from("demos").insert({ workspace_id: ws, created_by: owner.id, title: "Product tour", content: { scenes: [] }, authenticity_attested: true, redaction_acknowledged: true, settings: { lead_gate, allow_embed, cta_text: "Book a call", cta_url: "https://example.com/book" } }).select("id").single();
  if (error) throw new Error(error.message);
  const id = String(demo?.id);
  const path = `${ws}/${id}/${randomUUID()}.webp`;
  const bytes = await sharp({ create: { width: 320, height: 200, channels: 3, background: "#336699" } }).webp().toBuffer();
  await stack.admin.storage.from("demo-assets").upload(path, bytes, { contentType: "image/webp" });
  const { data: asset } = await stack.admin.from("demo_assets").insert({ workspace_id: ws, demo_id: id, file_path: path, kind: "screenshot", width: 320, height: 200, size_bytes: bytes.length, sha256: randomBytes(32).toString("hex") }).select("id").single();
  const assetId = String(asset?.id);
  const content = { scenes: [
    { id: "s1", type: "screenshot", assetId, hotspot: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 }, tooltip: { title: "Open reports", body: "Start here", position: "bottom" }, blurs: [], next: "auto" },
    { id: "c1", type: "chat", persona: { name: "Ava", role: "Agent" }, messages: [{ from: "agent", text: "Hello there, is 1 < 2 and a -> b?", delayMs: 0 }], choices: [] },
  ] };
  await stack.admin.from("demos").update({ content }).eq("id", id);
  for (const origin of origins) await stack.admin.from("demo_embed_origins").insert({ demo_id: id, workspace_id: ws, origin });
  if (publish) {
    const res = await stack.admin.from("demos").update({ status: "published", slug }).eq("id", id);
    if (res.error) throw new Error(res.error.message);
  }
  return { id, ws, workspace, slug, assetId };
}

describe("public demo page", () => {
  it("images are served only by the demo they belong to, and only while it is published", async () => {
    const d = await liveDemo();
    const other = await liveDemo({ slug: "other" });
    const ctx = await stack.browser.newContext({ extraHTTPHeaders: ipHeader() });
    const own = await ctx.request.get(site(d.workspace, `/demo/${d.slug}/asset/${d.assetId}`));
    expect(own.status()).toBe(200);
    expect(own.headers()["content-type"]).toBe("image/webp");
    expect(own.headers()["x-content-type-options"]).toBe("nosniff");
    // an image of another demo, asked for through this demo's address
    expect((await ctx.request.get(site(d.workspace, `/demo/${d.slug}/asset/${other.assetId}`))).status()).toBe(404);
    expect((await ctx.request.get(site(d.workspace, `/demo/${d.slug}/asset/not-a-uuid`))).status()).toBe(404);
    await stack.admin.from("demos").update({ status: "unpublished" }).eq("id", d.id);
    expect((await ctx.request.get(site(d.workspace, `/demo/${d.slug}/asset/${d.assetId}`))).status()).toBe(404);
    expect((await ctx.request.get(site(d.workspace, `/demo/${d.slug}`))).status()).toBe(404);
    await ctx.close();
  }, 90_000);

  it("renders step text literally, counts a view, and offers a call to action", async () => {
    const d = await liveDemo();
    const ctx = await stack.browser.newContext({ extraHTTPHeaders: ipHeader() });
    const page = await ctx.newPage();
    const res = await page.goto(site(d.workspace, `/demo/${d.slug}`));
    expect(res?.status()).toBe(200);
    expect(res?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    await page.getByRole("heading", { name: "Product tour" }).waitFor();
    await page.getByRole("button", { name: "Open reports" }).click();
    await page.getByText("Simulated example").waitFor();
    await page.getByText("Hello there, is 1 < 2 and a -> b?").waitFor();
    const events = async () => ((await stack.admin.from("demo_events").select("type, step_index").eq("demo_id", d.id)).data ?? []).map((e) => `${e.type}:${e.step_index ?? ""}`);
    const seen = async () => { const end = Date.now() + 10_000; let e = await events(); while (!(e.includes("view:") && e.includes("step:1")) && Date.now() < end) { await new Promise((r) => setTimeout(r, 400)); e = await events(); } return e; };
    expect(await seen()).toEqual(expect.arrayContaining(["view:", "step:1"]));
    await ctx.close();
  }, 90_000);

  it("the lead gate needs a valid email and consent, ignores bots, and stores nothing from other origins", async () => {
    const d = await liveDemo({ lead_gate: "start" });
    const none = await liveDemo({ lead_gate: "none", slug: "plain" });
    const ctx = await stack.browser.newContext({ extraHTTPHeaders: ipHeader() });
    const url = site(d.workspace, `/demo/${d.slug}/lead`);
    const origin = site(d.workspace, "").replace(/\/$/, "");
    const post = (data: unknown, headers: Record<string, string> = { origin }) => ctx.request.post(url, { data, headers });
    expect((await post({ email: "a@b.co", consent: true }, { origin: "https://evil.test" })).status()).toBe(403);
    expect((await post({ email: "a@b.co", consent: false })).status()).toBe(400);
    expect((await post({ email: "not-an-email", consent: true })).status()).toBe(400);
    expect((await post({ email: "a@b.co", consent: true, company: "bot" })).status()).toBe(400);
    expect((await post({ email: "a@b.co", consent: true, admin: true })).status()).toBe(400);
    expect((await stack.admin.from("demo_leads").select("id").eq("demo_id", d.id)).data).toHaveLength(0);
    expect((await post({ email: "visitor@example.test", name: "Vi Sitor", consent: true, step_reached: 1 })).status()).toBe(200);
    const { data: leads } = await stack.admin.from("demo_leads").select("email, name, consent, consent_text_version").eq("demo_id", d.id);
    expect(leads).toEqual([{ email: "visitor@example.test", name: "Vi Sitor", consent: true, consent_text_version: "demo-lead-v1" }]);
    // a demo that does not ask for emails collects none
    expect((await ctx.request.post(site(none.workspace, `/demo/${none.slug}/lead`), { data: { email: "x@y.co", consent: true }, headers: { origin: site(none.workspace, "").replace(/\/$/, "") } })).status()).toBe(200);
    expect((await stack.admin.from("demo_leads").select("id").eq("demo_id", none.id)).data).toHaveLength(0);

    // through the page: the form comes first, then the player
    const page = await ctx.newPage();
    await page.goto(site(d.workspace, `/demo/${d.slug}`));
    await page.getByLabel("Your email").fill("second@example.test");
    await page.getByRole("button", { name: "Continue" }).click(); // blocked by the browser until the box is ticked
    expect(await page.getByRole("checkbox").evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("Open reports").first().waitFor();
    await ctx.close();
  }, 90_000);

  it("embedding is allowed only for listed sites", async () => {
    const listed = await liveDemo({ allow_embed: true, origins: ["https://www.example.com", "https://blog.example.org"], slug: "listed" });
    const off = await liveDemo({ allow_embed: false, origins: ["https://www.example.com"], slug: "off" });
    const empty = await liveDemo({ allow_embed: true, origins: [], slug: "empty" });
    const ctx = await stack.browser.newContext({ extraHTTPHeaders: ipHeader() });
    const ok = await ctx.request.get(site(listed.workspace, "/demo/listed/embed"));
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-security-policy"]).toContain("frame-ancestors https://blog.example.org https://www.example.com");
    expect(ok.headers()["x-frame-options"]).toBeUndefined();
    // listing a site is not enough when embedding is off; embedding on with no site listed frames nowhere
    const disabled = await ctx.request.get(site(off.workspace, "/demo/off/embed"));
    expect(disabled.status()).toBe(404);
    expect(disabled.headers()["content-security-policy"]).toContain("frame-ancestors 'none'"); // the view hides the list while embedding is off
    const none = await ctx.request.get(site(empty.workspace, "/demo/empty/embed"));
    expect(none.status()).toBe(404);
    expect(none.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    // the normal page can never be framed
    expect((await ctx.request.get(site(listed.workspace, "/demo/listed"))).headers()["x-frame-options"]).toBe("DENY");
    await ctx.close();
  }, 90_000);

  it("events reject bad input and other origins; a report is stored without removing the demo", async () => {
    const d = await liveDemo();
    const ctx = await stack.browser.newContext({ extraHTTPHeaders: ipHeader() });
    const url = site(d.workspace, `/demo/${d.slug}/event`);
    const origin = site(d.workspace, "").replace(/\/$/, "");
    expect((await ctx.request.post(url, { data: { type: "view" }, headers: { origin: "https://evil.test" } })).status()).toBe(403);
    expect((await ctx.request.post(url, { data: { type: "lead" }, headers: { origin } })).status()).toBe(400);
    expect((await ctx.request.post(url, { data: { type: "step", step: 99 }, headers: { origin } })).status()).toBe(204);
    expect((await stack.admin.from("demo_events").select("id").eq("demo_id", d.id).eq("step_index", 99)).data).toHaveLength(0); // beyond the last step

    const page = await ctx.newPage();
    await page.goto(site(d.workspace, `/demo/${d.slug}/report`));
    await page.getByLabel(/What is wrong|reason|Tell us/i).first().fill("This demo shows a real customer's name in a screenshot.");
    await page.getByLabel(/email/i).first().fill("reporter@example.test");
    await page.getByRole("button", { name: /send|submit|report/i }).first().click();
    await page.getByText(/thank/i).first().waitFor();
    const { data: reports } = await stack.admin.from("demo_reports").select("status").eq("demo_id", d.id);
    expect(reports).toEqual([{ status: "open" }]);
    expect((await stack.admin.from("demos").select("status").eq("id", d.id).single()).data?.status).toBe("published");
    await ctx.close();
  }, 90_000);
});

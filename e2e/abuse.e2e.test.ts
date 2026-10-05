import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { loadLocalConfig } from "../supabase/tests/isolation/harness";
import { BASE, startStack, stopStack, type Stack } from "./harness";

let stack: Stack;
let wsId: string;

// Decided at load time (skipIf is evaluated at collection). Uploads need the Storage service.
const storageAvailable = await (async () => {
  const cfg = loadLocalConfig();
  const res = await fetch(`${cfg.url}/storage/v1/bucket`, { headers: { apikey: cfg.serviceKey, authorization: `Bearer ${cfg.serviceKey}` } }).catch(() => null);
  return res?.status === 200;
})();

beforeAll(async () => {
  // Low limits so the tests can reach them quickly.
  stack = await startStack({ AI_DAILY_TOKEN_LIMIT: "1000", INTERVIEW_STARTS_PER_IP_HOUR: "3" });
  const owner = await stack.admin.auth.admin.createUser({ email: `ab-${randomBytes(4).toString("hex")}@example.test`, password: randomBytes(18).toString("base64url"), email_confirm: true });
  const { data: ws } = await stack.admin.from("workspaces").insert({ name: "Abuse Co", type: "agency", plan: "team" }).select("id").single();
  wsId = String(ws?.id);
  await stack.admin.from("workspace_members").insert({ workspace_id: wsId, user_id: owner.data.user!.id, role: "owner" });
}, 120_000);

afterAll(async () => {
  await stack.admin.from("ai_daily_usage").delete().neq("day", "1900-01-01");
  await stack.admin.from("workspaces").delete().eq("id", wsId);
  await stopStack(stack);
});

async function makeLink() {
  const raw = randomBytes(32).toString("base64url");
  const { data } = await stack.admin.from("proof_requests").insert({
    workspace_id: wsId, client_name: "Alex Rowe", client_email: "alex@example.test", flow_type: "agency",
    token_hash: createHash("sha256").update(raw).digest("hex"), expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: "sent",
  }).select("id").single();
  return { raw, id: String(data?.id), url: `${BASE}/i/${raw}` };
}

let n = 0;
const ip = () => `203.0.113.${(Date.now() + ++n) % 250 + 1}`;
async function phone() {
  const context = await stack.browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true, extraHTTPHeaders: { "x-forwarded-for": ip() } });
  return { context, page: await context.newPage() };
}
const post = (path: string, body: unknown, address = ip()) =>
  fetch(`${BASE}/api/interview/${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": address }, body: JSON.stringify(body) });
const LONG = "We were struggling with a slow manual process that cost the team many hours every week and made clients wait far too long";

describe("simple form fallback", () => {
  it("lets a client switch from the chat to a form for the remaining questions", async () => {
    const link = await makeLink();
    const { context, page } = await phone();
    await page.goto(link.url);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Start the interview" }).click();
    await page.getByLabel("Your answer").fill(LONG);
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByText("Question 2 of 6").waitFor();

    await page.getByRole("button", { name: "Switch to a simple form" }).click();
    await page.getByRole("heading", { name: "Simple form" }).waitFor();
    expect(await page.locator("textarea").count(), "form should cover only the 5 remaining questions").toBe(5);

    await page.getByRole("button", { name: "Submit answers" }).click();
    await page.getByText(/Please answer every question/).waitFor();
    for (const box of await page.locator("textarea").all()) await box.fill("A short form answer.");
    await page.getByRole("button", { name: "Submit answers" }).click();
    await page.getByRole("heading", { name: "Almost done" }).waitFor();

    const { data: interview } = await stack.admin.from("interviews").select("question_index,message_count").eq("request_id", link.id).single();
    expect(interview).toMatchObject({ question_index: 6, message_count: 13 });
    await context.close();
  }, 120_000);
});

describe("abuse protection", () => {
  it("rejects more than 3 interview starts per IP per hour (limit lowered for the test)", async () => {
    const address = "198.51.100.200";
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const link = await makeLink();
      const res = await post("start", { token: link.raw, consent: true, consentVersion: "2026-10-v1" }, address);
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it("pauses every interview endpoint with a maintenance message once the daily AI spend limit is hit, and resumes after", async () => {
    const link = await makeLink();
    const day = new Date().toISOString().slice(0, 10);
    await stack.admin.from("ai_daily_usage").upsert({ day, tokens: 5000, alerted: false });

    const page = await fetch(link.url, { headers: { "x-forwarded-for": ip() } });
    expect(await page.text()).toContain("Back soon");
    const api = await post("start", { token: link.raw, consent: true, consentVersion: "2026-10-v1" });
    expect(api.status).toBe(503);
    expect(await api.json()).toMatchObject({ error: "maintenance" });
    // Bad links still get the normal 404, not a hint that anything is special.
    expect((await post("message", { token: "x", message: "hi" })).status).toBe(404);

    await stack.admin.from("ai_daily_usage").delete().eq("day", day);
    expect((await fetch(link.url, { headers: { "x-forwarded-for": ip() } })).status).toBe(200);
  });

  it("rejects uploads without a valid link, with a wrong content type, or oversized", async () => {
    const form = new FormData();
    form.set("token", randomBytes(32).toString("base64url"));
    form.set("kind", "logo");
    form.set("file", new Blob([await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer()]), "a.png");
    expect((await fetch(`${BASE}/api/interview/upload`, { method: "POST", body: form, headers: { "x-forwarded-for": ip() } })).status).toBe(404);
    expect((await fetch(`${BASE}/api/interview/upload`, { method: "POST", body: "{}", headers: { "content-type": "application/json", "x-forwarded-for": ip() } })).status).toBe(400);
    const huge = new Uint8Array(3 * 1024 * 1024);
    expect((await fetch(`${BASE}/api/interview/upload`, { method: "POST", body: huge, headers: { "content-type": "multipart/form-data; boundary=x", "x-forwarded-for": ip() } })).status).toBe(413);
  });
});

describe("logo and headshot upload in the browser", () => {
  it.skipIf(!storageAvailable)("accepts a real image, strips it to WebP in the private bucket, and refuses a renamed executable", async () => {
    const link = await makeLink();
    const { context, page } = await phone();
    await page.goto(link.url);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Start the interview" }).click();
    await page.getByRole("button", { name: "Switch to a simple form" }).click();
    for (const box of await page.locator("textarea").all()) await box.fill("Answer.");
    await page.getByRole("button", { name: "Submit answers" }).click();
    await page.getByRole("heading", { name: "Almost done" }).waitFor();

    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]), Buffer.alloc(200, 1)]);
    await page.getByLabel("Company logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: exe });
    await page.getByRole("alert").getByText(/does not look like a valid/).waitFor();

    const png = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#cc3333" } }).png().toBuffer();
    await page.getByLabel("Company logo").setInputFiles({ name: "Acme Logo Final.png", mimeType: "image/png", buffer: png });
    await page.getByText(/Uploaded/).first().waitFor();

    const { data } = await stack.admin.from("interview_uploads").select("file_path,kind").eq("workspace_id", wsId);
    expect(data).toHaveLength(1);
    expect(data?.[0].file_path).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/);
    const downloaded = await stack.admin.storage.from("uploads").download(String(data?.[0].file_path));
    const meta = await sharp(Buffer.from(await downloaded.data!.arrayBuffer())).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 1200 });

    // The bucket is private: the public URL does not serve the file.
    const publicUrl = `${stack.cfg.url}/storage/v1/object/public/uploads/${data?.[0].file_path}`;
    expect((await fetch(publicUrl)).ok).toBe(false);
    await context.close();
  }, 120_000);
});

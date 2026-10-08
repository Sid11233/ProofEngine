import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { BASE, createUser, newPage, signIn, startStack, stopStack, type Stack } from "./harness";

let stack: Stack;
let stub: Server;
let micBrowser: Browser;
const received: Array<{ type: string; body: string }> = [];
const TRANSCRIPT = "We were struggling with a slow manual process <b>every</b> week and the team lost many hours before we found help";

beforeAll(async () => {
  stub = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push({ type: String(req.headers["content-type"]), body: Buffer.concat(chunks).toString("latin1") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ text: TRANSCRIPT }));
    });
  }).listen(0, "127.0.0.1");
  await new Promise((r) => stub.once("listening", r));
  const port = (stub.address() as AddressInfo).port;
  stack = await startStack({ OPENAI_API_KEY: "sk-test-stub-key-0123456789abcdef", TRANSCRIBE_API_URL: `http://127.0.0.1:${port}/v1/audio/transcriptions` });
  micBrowser = await chromium.launch({ args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
}, 120_000);

afterAll(async () => {
  await micBrowser?.close();
  stub?.close();
  await stopStack(stack);
});

async function link(userId: string) {
  const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", userId).single();
  const ws = String(member?.workspace_id);
  await stack.admin.from("workspaces").update({ plan: "team" }).eq("id", ws);
  const raw = randomBytes(32).toString("base64url");
  const { data } = await stack.admin.from("proof_requests").insert({
    workspace_id: ws, client_name: "Taylor Morgan", client_email: "taylor@example.test", flow_type: "agency", token_hash: createHash("sha256").update(raw).digest("hex"),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: "sent",
  }).select("id").single();
  return { ws, id: String(data?.id), raw, url: `${BASE}/i/${raw}` };
}

describe("voice answers", () => {
  it("a client records an answer, reviews the text, sends it; the team can listen; nobody else can; it expires", async () => {
    const owner = await createUser(stack.admin, "vo-e2e");
    const other = await createUser(stack.admin, "vo-e2e-other");
    const l = await link(owner.id);

    const context = await micBrowser.newContext({ viewport: { width: 390, height: 800 }, permissions: ["microphone"], extraHTTPHeaders: { "x-forwarded-for": "198.51.100.81" } });
    const page = await context.newPage();
    await page.goto(l.url);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Start the interview" }).click();
    await page.getByText("Question 1 of 6").waitFor();

    await page.getByRole("button", { name: "Answer by voice" }).click();
    await page.getByText(/speech-to-text service/).waitFor();
    expect(await page.getByRole("button", { name: "Start recording" }).isDisabled()).toBe(true); // needs "I understand"
    await page.getByLabel("I understand").check();
    await page.getByRole("button", { name: "Start recording" }).click();
    await page.getByText(/Recording 0:0/).waitFor();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Stop" }).click();
    await page.waitForFunction((t) => (document.getElementById("answer") as HTMLTextAreaElement | null)?.value === t, TRANSCRIPT, { timeout: 20_000 });

    // the provider got audio and a model name, and nothing that identifies the client or the link
    expect(received).toHaveLength(1);
    expect(received[0].type).toContain("multipart/form-data");
    expect(received[0].body).toContain('name="model"');
    expect(received[0].body).not.toContain(l.raw);
    expect(received[0].body).not.toMatch(/taylor|example\.test/i);

    await page.getByRole("button", { name: "Send" }).click();
    await page.getByText("Question 2 of 6").waitFor();
    const { data: interview } = await stack.admin.from("interviews").select("id").eq("request_id", l.id).single();
    const { data: voice } = await stack.admin.from("interview_voice").select("id, message_id, mime_type, consent_text_version").eq("interview_id", interview?.id);
    expect(voice).toHaveLength(1);
    expect(voice![0]).toMatchObject({ mime_type: "audio/webm", consent_text_version: "voice-2026-10-v1" });
    const { data: message } = await stack.admin.from("interview_messages").select("content").eq("id", voice![0].message_id).single();
    expect(message?.content).toBe(TRANSCRIPT);

    // bad uploads are refused
    const post = (fields: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>) => context.request.post(`${BASE}/api/interview/voice`, { multipart: { token: l.raw, consentVersion: "voice-2026-10-v1", ...fields } });
    expect((await post({ audio: { name: "a.webm", mimeType: "audio/webm", buffer: Buffer.from("<svg onload=alert(1)>") } })).status()).toBe(400);
    expect((await post({ consentVersion: "old", audio: { name: "a.webm", mimeType: "audio/webm", buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1]) } })).status()).toBe(400);
    expect((await post({ audio: { name: "a.webm", mimeType: "audio/webm", buffer: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(3.2 * 1024 * 1024)]) } })).status()).toBe(413);
    expect(received).toHaveLength(1);

    // the team listens and reads what the client confirmed
    const team = await newPage(stack);
    await signIn(team, owner.email, owner.password);
    await team.waitForURL(`${BASE}/app/dashboard`);
    await team.goto(`${BASE}/app/requests/${l.id}`);
    await team.getByRole("heading", { name: "Voice answers" }).waitFor();
    expect(await team.getByTestId("voice-answer").textContent()).toBe(TRANSCRIPT);
    expect(await team.locator("[data-testid=voice-answer] b").count()).toBe(0);
    const src = await team.locator("audio").getAttribute("src");
    const heard = await team.request.get(`${BASE}${src}`);
    expect(heard.status()).toBe(200);
    expect(heard.headers()["content-type"]).toBe("audio/webm");
    expect(heard.headers()["x-content-type-options"]).toBe("nosniff");

    // nobody else can: anonymous and another workspace both get 404
    expect((await stack.browser.newContext().then((c) => c.request.get(`${BASE}${src}`))).status()).toBe(404);
    const outsider = await newPage(stack);
    await signIn(outsider, other.email, other.password);
    await outsider.waitForURL(`${BASE}/app/dashboard`);
    expect((await outsider.request.get(`${BASE}${src}`)).status()).toBe(404);

    // after 30 days it is gone
    await stack.admin.from("interview_voice").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", voice![0].id);
    expect((await team.request.get(`${BASE}${src}`)).status()).toBe(404);
    await context.close();
  }, 240_000);
});

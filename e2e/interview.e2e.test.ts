import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { BASE, startStack, stopStack, watchConsole, type Stack } from "./harness";

let stack: Stack;
let wsId: string;

beforeAll(async () => {
  stack = await startStack();
  const owner = await stack.admin.auth.admin.createUser({ email: `iv-${randomBytes(4).toString("hex")}@example.test`, password: randomBytes(18).toString("base64url"), email_confirm: true });
  const id = owner.data.user!.id;
  const { data: ws } = await stack.admin.from("workspaces").insert({ name: "Mobile Co", type: "agency", plan: "team" }).select("id").single();
  wsId = String(ws?.id);
  await stack.admin.from("workspace_members").insert({ workspace_id: wsId, user_id: id, role: "owner" });
}, 120_000);

afterAll(async () => {
  await stack.admin.from("workspaces").delete().eq("id", wsId);
  await stopStack(stack);
});

async function makeLink(name = "Taylor Morgan") {
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  const { data } = await stack.admin.from("proof_requests").insert({
    workspace_id: wsId, client_name: name, client_email: "taylor@example.test", flow_type: "agency", token_hash: hash,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: "sent",
  }).select("id").single();
  return { raw, id: String(data?.id), url: `${BASE}/i/${raw}` };
}

const LONG = "We were struggling with a slow manual process that cost the team many hours every week and made clients wait far too long";
let ipCounter = 0;
const ip = () => `192.0.2.${(Date.now() + ++ipCounter) % 250 + 1}`;

async function phone() {
  const context = await stack.browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true, extraHTTPHeaders: { "x-forwarded-for": ip() } });
  return { context, page: await context.newPage() };
}

describe("the client interview on a phone", () => {
  it("walks from consent through six questions to a finished interview, with no account and no cookies", async () => {
    const link = await makeLink();
    const { context, page } = await phone();
    const problems = watchConsole(page);

    await page.goto(link.url);
    await page.getByRole("heading", { name: "Hi Taylor" }).waitFor();
    await page.getByText(/about 3 minutes/).waitFor();

    // Consent is required.
    const start = page.getByRole("button", { name: "Start the interview" });
    expect(await start.isDisabled()).toBe(true);
    await page.getByRole("checkbox").check();
    await start.click();

    await page.getByText("Question 1 of 6").waitFor();
    await page.getByText(/what problem or goal were you trying to deal with/i).waitFor();

    // Usable at 360px: no sideways scroll, 16px+ input text, 44px+ buttons.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const fontSize = await page.getByLabel("Your answer").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
    await page.getByLabel("Your answer").fill("x".repeat(5));
    expect((await page.getByRole("button", { name: "Send" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // Sentence starters ("pre-answers") only put words in the box; a bare starter cannot be sent.
    await page.getByLabel("Your answer").fill("");
    await page.getByRole("button", { name: "We were struggling with…" }).click();
    expect(await page.getByLabel("Your answer").inputValue()).toBe("We were struggling with ");
    expect(await page.getByRole("button", { name: "Send" }).isDisabled()).toBe(true);

    // A markup payload is shown as text and never becomes an element.
    const xss = `<img src=x onerror="document.title='pwned'"><script>document.title='pwned'</script> ${LONG}`;
    await page.getByLabel("Your answer").fill(xss);
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByText("Question 2 of 6").waitFor();
    expect(await page.locator("[role=log] img, [role=log] script").count()).toBe(0);
    expect(await page.title()).not.toBe("pwned");
    await page.getByText(/<img src=x/).first().waitFor();

    for (let q = 2; q <= 6; q++) {
      await page.getByText(`Question ${q} of 6`).waitFor();
      await page.getByLabel("Your answer").fill(`${LONG} (answer ${q})`);
      await page.getByRole("button", { name: "Send" }).click();
    }
    await page.getByText(/That is everything I wanted to ask/).waitFor();
    await page.getByRole("button", { name: "Continue" }).click();

    // Closing: credit choice is required; half-filled referrals are ignored.
    await page.getByRole("button", { name: "Finish" }).click();
    await page.getByText("Please choose how we may credit you.").waitFor();
    await page.getByLabel("First name only").check();
    await page.locator("#ref-name-0").fill("Sam Lee");
    await page.locator("#ref-contact-0").fill("sam@example.test");
    await page.getByRole("button", { name: "Add another" }).click();
    await page.locator("#ref-name-1").fill("Half Filled");
    // Private feedback and optional details.
    await page.getByRole("radio", { name: "4 out of 5" }).click();
    await page.locator("#closing-comment").fill("Great team <b>really</b>.");
    await page.locator("#closing-company").fill("Acme Roofing");
    await page.locator("#closing-email").fill("not-an-email");
    await page.getByRole("button", { name: "Finish" }).click();
    await page.getByText("Please enter a valid email address, or clear that box.").waitFor();
    await page.locator("#closing-email").fill("taylor@acme.test");
    await page.getByRole("button", { name: "Finish" }).click();
    await page.getByRole("heading", { name: "Thank you, Taylor!" }).waitFor();

    expect(await context.cookies(), "the interview set cookies").toEqual([]);
    expect(problems, `console problems: ${problems.join(" | ")}`).toEqual([]);

    const { data: interview } = await stack.admin.from("interviews").select("*").eq("request_id", link.id).single();
    expect(interview).toMatchObject({ status: "completed", consent_given: true, publish_permission: "first_name", message_count: 13 });
    const { data: refs } = await stack.admin.from("referrals").select("referred_name").eq("interview_id", interview?.id);
    expect(refs).toEqual([{ referred_name: "Sam Lee" }]);
    const { data: closing } = await stack.admin.from("interview_closing").select("rating, comment, company, contact_email, contact_phone").eq("interview_id", interview?.id);
    expect(closing).toEqual([{ rating: 4, comment: "Great team <b>really</b>.", company: "Acme Roofing", contact_email: "taylor@acme.test", contact_phone: null }]);
    const { data: msgs } = await stack.admin.from("interview_messages").select("content").eq("interview_id", interview?.id).eq("role", "client").order("created_at").limit(1);
    expect(msgs?.[0].content, "the client's words must be stored exactly as typed").toBe(xss);

    // The link is now closed.
    expect((await fetch(link.url)).status).toBe(404);
    await context.close();
  }, 180_000);

  it("resumes where the client left off after a reload", async () => {
    const link = await makeLink();
    const { context, page } = await phone();
    await page.goto(link.url);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Start the interview" }).click();
    await page.getByLabel("Your answer").fill(LONG);
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByText("Question 2 of 6").waitFor();

    await page.reload();
    await page.getByText("Question 2 of 6").waitFor();
    await page.getByText(LONG).waitFor();
    await context.close();
  }, 120_000);

  it("restores the typed answer if sending fails", async () => {
    const link = await makeLink();
    const { context, page } = await phone();
    await page.goto(link.url);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Start the interview" }).click();
    await page.getByText("Question 1 of 6").waitFor();

    await page.route("**/api/interview/message", (route) => route.abort());
    await page.getByLabel("Your answer").fill("My careful answer");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByRole("alert").getByText(/Something went wrong/).waitFor();
    expect(await page.getByLabel("Your answer").inputValue()).toBe("My careful answer");
    await context.close();
  }, 120_000);
});

describe("the interview API", () => {
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${BASE}/api/interview/${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

  it("answers an unknown or malformed token with the same 404", async () => {
    for (const token of [randomBytes(32).toString("base64url"), "short", "", "../../x"]) {
      const res = await post("message", { token, message: "hi" });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect((await post("start", { token: "x", consent: true })).status).toBe(404);
    expect((await post("finish", { token: "x" })).status).toBe(404);
  });

  it("rejects bad bodies, wrong consent, extra fields and giant payloads for a valid link", async () => {
    const link = await makeLink();
    expect((await post("message", "not json")).status).toBe(400);
    expect((await post("message", "x".repeat(20_000))).status).toBe(400);
    expect((await post("start", { token: link.raw, consent: false, consentVersion: "x" })).status).toBe(400);
    expect((await post("start", { token: link.raw, consent: true, consentVersion: "old-version" })).status).toBe(400);
    expect((await post("message", { token: link.raw, message: "hello", role: "bot" })).status, "unknown fields accepted").toBe(400);
    expect((await post("message", { token: link.raw, message: "x".repeat(1001) })).status).toBe(400);
    // Before consent there is no interview to answer.
    expect((await post("message", { token: link.raw, message: "hello" })).status).toBe(409);
    expect((await post("finish", { token: link.raw, publishPermission: "full" })).status).toBe(409);
  });

  it("carries the privacy headers on every response", async () => {
    const res = await post("message", { token: "x", message: "hi" });
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("throttles a flood of messages on one token to 10 per minute", async () => {
    const link = await makeLink();
    const headers = { "x-forwarded-for": "198.51.100.77" };
    expect((await post("start", { token: link.raw, consent: true, consentVersion: (await (await fetch(link.url, { headers })).text()).match(/2026-10-v1/)?.[0] ?? "2026-10-v1" }, headers)).status).toBe(200);
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await post("message", { token: link.raw, message: i < 6 ? LONG : "ok" }, { "x-forwarded-for": `198.51.100.${100 + i}` })).status);
    expect(statuses.filter((s) => s === 429).length, `statuses: ${statuses}`).toBeGreaterThan(0);
    expect(statuses.slice(0, 10).includes(429)).toBe(false);
  });
});

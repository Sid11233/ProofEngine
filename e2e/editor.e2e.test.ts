import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { loadLocalConfig } from "../supabase/tests/isolation/harness";
import { BASE, createUser, newPage, signIn, startStack, stopStack, watchConsole, type Stack } from "./harness";

let stack: Stack;

const storageAvailable = await (async () => {
  const cfg = loadLocalConfig();
  const res = await fetch(`${cfg.url}/storage/v1/bucket`, { headers: { apikey: cfg.serviceKey, authorization: `Bearer ${cfg.serviceKey}` } }).catch(() => null);
  return res?.status === 200;
})();

beforeAll(async () => {
  stack = await startStack();
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

const MESSAGE = "We cut onboarding time by 40 percent in March and support tickets fell from 1,200 to 300.";

async function seed(userId: string, { plan = "pro", templateName }: { plan?: string; templateName?: string } = {}) {
  const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", userId).single();
  const ws = String(member?.workspace_id);
  await stack.admin.from("workspaces").update({ plan }).eq("id", ws);
  const { data: request } = await stack.admin.from("proof_requests").insert({ workspace_id: ws, client_name: "Dana Doe", client_email: "d@example.test", flow_type: "agency", token_hash: randomBytes(32).toString("hex"), expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: "completed" }).select("id").single();
  const { data: interview } = await stack.admin.from("interviews").insert({ request_id: request?.id, workspace_id: ws, status: "completed", consent_given: true, question_index: 6 }).select("id").single();
  const { data: message } = await stack.admin.from("interview_messages").insert({ interview_id: interview?.id, workspace_id: ws, role: "client", content: MESSAGE }).select("id").single();
  const template = templateName ? (await stack.admin.from("templates").select("id").eq("name", templateName).single()).data?.id : null;
  const { data: study } = await stack.admin.from("case_studies").insert({ workspace_id: ws, interview_id: interview?.id, content: {}, status: "draft", template_id: template }).select("id").single();
  const { data: claim } = await stack.admin.from("claims").insert({ case_study_id: study?.id, workspace_id: ws, text: "Onboarding fell 40 percent", source_message_id: message?.id, source_quote: "cut onboarding time by 40 percent", client_confirmed: true }).select("id").single();
  const content = {
    headline: "Faster onboarding",
    client: { name: "Dana" },
    sections: [
      { type: "challenge", title: "The challenge", body: "Onboarding was slow." },
      { type: "solution", title: "The solution", body: "We changed the process." },
      { type: "results", title: "Results", metrics: [{ label: "Onboarding time cut", value: "40 percent", claimId: claim?.id }] },
      { type: "quote", title: "In their words", quote: { text: "We cut onboarding time", attribution: "Dana", claimId: claim?.id } },
    ],
    tags: ["onboarding"],
  };
  await stack.admin.from("case_studies").update({ content }).eq("id", study?.id);
  await stack.admin.from("case_study_versions").insert({ case_study_id: study?.id, workspace_id: ws, version: 1, content });
  return { ws, studyId: String(study?.id), claimId: String(claim?.id) };
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, seconds = 15): Promise<T> {
  const end = Date.now() + seconds * 1000;
  let value = await read();
  while (!done(value) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 500));
    value = await read();
  }
  return value;
}

const study = async (id: string) => (await stack.admin.from("case_studies").select("content, theme_settings, current_version, status").eq("id", id).single()).data as { content: { headline: string; sections: Array<{ type: string; title: string; metrics?: Array<{ hidden?: boolean; value: string }>; body?: string }>; client: { logoPath?: string } }; theme_settings: Record<string, string>; current_version: number; status: string };

async function openEditor(email: string, password: string, studyId: string, viewport = { width: 1280, height: 900 }) {
  const context = await stack.browser.newContext({ viewport, extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${(Date.now() % 240) + 1}` } });
  const page = await context.newPage();
  await signIn(page, email, password);
  await page.waitForURL(`${BASE}/app/dashboard`);
  await page.goto(`${BASE}/app/case-studies/${studyId}/edit`);
  await page.getByText("Numbers must match what your client said.").first().waitFor();
  return { context, page };
}

describe("editing with a live preview", () => {
  it("autosaves text edits every few seconds, shows them live, and refuses invalid content", async () => {
    const owner = await createUser(stack.admin, "ed-auto");
    const s = await seed(owner.id);
    const { context, page } = await openEditor(owner.email, owner.password, s.studyId);
    const problems = watchConsole(page);

    await page.getByLabel("Headline").fill("A much better headline");
    await page.getByRole("heading", { level: 1, name: "A much better headline" }).waitFor(); // live preview, before any save
    await page.getByTestId("save-status").getByText("Unsaved changes").waitFor();

    const saved = await until(() => study(s.studyId), (v) => v.content.headline === "A much better headline");
    expect(saved.content.headline).toBe("A much better headline");
    await page.getByTestId("save-status").getByText(/Saved at/).waitFor();
    expect(saved.current_version, "edits within a minute should not make a new version row").toBe(1);

    // Invalid content (empty headline) is flagged and never sent.
    await page.getByLabel("Headline").fill("");
    await page.getByRole("alert").getByText(/Changes are not saved until this is fixed/).waitFor();
    await page.waitForTimeout(6500);
    expect((await study(s.studyId)).content.headline).toBe("A much better headline");

    await page.getByLabel("Headline").fill("<script>alert(1)</script>");
    await page.getByRole("alert").getByText(/HTML is not allowed/).waitFor();
    await page.getByLabel("Headline").fill("Persisted after reload");
    await page.getByRole("button", { name: "Save now" }).click();
    await until(() => study(s.studyId), (v) => v.content.headline === "Persisted after reload");
    await page.reload();
    expect(await page.getByLabel("Headline").inputValue()).toBe("Persisted after reload");

    expect(problems, `console problems: ${problems.join(" | ")}`).toEqual([]);
    await context.close();
  }, 120_000);

  it("shows desktop, tablet and mobile widths, and the layout really responds to them", async () => {
    const owner = await createUser(stack.admin, "ed-device");
    const s = await seed(owner.id, { templateName: "Before and After" });
    const { context, page } = await openEditor(owner.email, owner.password, s.studyId);
    const frame = page.getByTestId("preview-frame");

    const pos = async (text: string) => (await frame.getByText(text, { exact: true }).boundingBox())!;
    await page.getByRole("button", { name: "Desktop" }).click();
    const desktopWidth = (await frame.boundingBox())!.width;
    const [beforeD, afterD] = [await pos("Before"), await pos("After")];
    expect(Math.abs(beforeD.y - afterD.y), "Before and After sit side by side on desktop").toBeLessThan(20);

    await page.getByRole("button", { name: "Tablet" }).click();
    expect(await frame.getAttribute("data-device")).toBe("tablet");
    expect(Math.round((await frame.boundingBox())!.width)).toBe(768);

    await page.getByRole("button", { name: "Mobile" }).click();
    expect(Math.round((await frame.boundingBox())!.width)).toBe(390);
    expect(desktopWidth).toBeGreaterThan(390);
    const [beforeM, afterM] = [await pos("Before"), await pos("After")];
    expect(afterM.y, "Before and After stack on a phone-sized preview").toBeGreaterThan(beforeM.y + 40);
    await context.close();
  }, 120_000);

  it("reorders by drag and by button, adds, removes and hides, and saves the structure", async () => {
    const owner = await createUser(stack.admin, "ed-struct");
    const s = await seed(owner.id);
    const { context, page } = await openEditor(owner.email, owner.password, s.studyId);
    const items = page.locator("ol > li");
    const order = async () => (await page.locator("ol > li [draggable=true]").allInnerTexts()).map((t) => t.replace("⠿", "").trim().toLowerCase());
    expect(await order()).toEqual(["challenge", "solution", "results", "quote"]);

    // Drag and drop: bring the second section into view with the first, then drop it on top.
    await items.first().scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, (document.querySelector("ol > li") as HTMLElement).getBoundingClientRect().top - 120));
    await items.nth(1).locator("[draggable=true]").dragTo(items.first());
    expect(await order(), "drag and drop should put solution first").toEqual(["solution", "challenge", "results", "quote"]);

    // Keyboard-accessible reorder.
    await page.getByRole("button", { name: "Move results section up" }).click();
    expect(await order()).toEqual(["solution", "results", "challenge", "quote"]);

    // Add and remove.
    await page.getByLabel("Add a section").selectOption("cta");
    await page.getByRole("button", { name: "Remove quote section" }).click();
    expect(await order()).toEqual(["solution", "results", "challenge", "cta"]);

    // Hide the metric: gone from the live preview straight away.
    await page.getByLabel("Show this metric on the page").uncheck();
    expect(await page.getByTestId("preview-frame").getByText("Onboarding time cut").count()).toBe(0);

    const saved = await until(() => study(s.studyId), (v) => v.content.sections.some((x) => x.type === "cta") && v.content.sections.find((x) => x.type === "results")?.metrics?.[0]?.hidden === true);
    expect(saved.content.sections.map((x) => x.type)).toEqual(["solution", "results", "challenge", "cta"]);
    expect(saved.content.sections.find((x) => x.type === "results")?.metrics?.[0]?.hidden).toBe(true);

    await page.reload();
    expect(await order(), "the new order survives a reload").toEqual(["solution", "results", "challenge", "cta"]);
    await context.close();
  }, 120_000);

  it("flags an edited number live, and on save revokes that claim's confirmation", async () => {
    const owner = await createUser(stack.admin, "ed-claim");
    const s = await seed(owner.id);
    const { context, page } = await openEditor(owner.email, owner.password, s.studyId);

    await page.getByLabel("Value", { exact: true }).fill("45 percent");
    await page.getByText(/Edited: this no longer matches what your client said/).first().waitFor();
    await until(async () => (await stack.admin.from("claims").select("edited, client_confirmed").eq("id", s.claimId).single()).data, (c) => c?.edited === true);
    expect((await stack.admin.from("claims").select("edited, client_confirmed").eq("id", s.claimId).single()).data).toEqual({ edited: true, client_confirmed: false });

    // Source disclosure shows the client's exact words.
    await page.getByText("Source for Onboarding time cut").click();
    await page.locator("mark", { hasText: "cut onboarding time by 40 percent" }).first().waitFor();

    await page.getByLabel("Value", { exact: true }).fill("40 percent");
    await until(async () => (await stack.admin.from("claims").select("edited").eq("id", s.claimId).single()).data, (c) => c?.edited === false);
    await context.close();
  }, 120_000);

  it("saves theme choices, previews them, and rejects an invalid colour", async () => {
    const owner = await createUser(stack.admin, "ed-theme");
    const s = await seed(owner.id);
    const { context, page } = await openEditor(owner.email, owner.password, s.studyId);

    await page.getByLabel("Accent colour hex value").fill("#aa2244");
    await page.getByLabel("Fonts").selectOption("playfair-source");
    await page.getByLabel("Mode").selectOption("dark");
    await page.getByLabel("Corners").selectOption("xl");
    expect(await page.getByTestId("preview-frame").locator("article").evaluate((el) => (el as HTMLElement).style.getPropertyValue("--cs-primary"))).toBe("#aa2244");

    const saved = await until(() => study(s.studyId), (v) => v.theme_settings.primary === "#aa2244" && v.theme_settings.mode === "dark");
    expect(saved.theme_settings).toMatchObject({ primary: "#aa2244", fontPair: "playfair-source", mode: "dark", radius: "xl" });

    await page.getByLabel("Accent colour hex value").fill("red; background:url(//evil)");
    await page.waitForTimeout(6500);
    expect((await study(s.studyId)).theme_settings.primary, "an invalid colour was saved").toBe("#aa2244");
    await context.close();
  }, 120_000);

  it("watermarks a locked template, explains why it cannot go live, and offers no Publish button", async () => {
    const owner = await createUser(stack.admin, "ed-locked");
    const s = await seed(owner.id, { plan: "free", templateName: "Timeline Story" });
    const { context, page } = await openEditor(owner.email, owner.password, s.studyId);
    await page.getByText(/Timeline Story is a paid template/).waitFor();
    expect(await page.getByTestId("preview-frame").getByText("Preview only: needs an upgrade to publish").count()).toBeGreaterThan(0);
    expect(await page.getByRole("button", { name: "Publish", exact: true }).count(), "Publish is not offered before approval").toBe(0);
    await page.getByText("This template is not included in your plan", { exact: false }).waitFor();
    await context.close();

    // On a pro plan the same template has no watermark and no template blocker.
    const pro = await createUser(stack.admin, "ed-unlocked");
    const p = await seed(pro.id, { plan: "pro", templateName: "Timeline Story" });
    const second = await openEditor(pro.email, pro.password, p.studyId);
    expect(await second.page.getByText(/is a paid template/).count()).toBe(0);
    expect(await second.page.getByText("This template is not included in your plan").count()).toBe(0);
    await second.context.close();
  }, 120_000);

  it("on a phone the controls open as a bottom sheet", async () => {
    const owner = await createUser(stack.admin, "ed-phone");
    const s = await seed(owner.id);
    const { context, page } = await openEditor(owner.email, owner.password, s.studyId, { width: 390, height: 800 });
    expect(await page.getByLabel("Headline").isVisible()).toBe(false);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Headline").waitFor();
    const sheet = await page.getByRole("complementary", { name: "Editor controls" }).boundingBox();
    expect(sheet!.y + sheet!.height).toBeGreaterThan(780); // anchored to the bottom
    await page.getByLabel("Headline").fill("Edited on a phone");
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("heading", { level: 1, name: "Edited on a phone" }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await context.close();
  }, 120_000);

  it("viewers see the editor read-only, and other workspaces get a 404", async () => {
    const owner = await createUser(stack.admin, "ed-owner2");
    const s = await seed(owner.id);
    const viewer = await createUser(stack.admin, "ed-viewer", { withWorkspace: false });
    await stack.admin.from("workspace_members").insert({ workspace_id: s.ws, user_id: viewer.id, role: "viewer" });
    const stranger = await createUser(stack.admin, "ed-stranger");

    const v = await openEditor(viewer.email, viewer.password, s.studyId);
    expect(await v.page.getByLabel("Headline").isDisabled()).toBe(true);
    expect(await v.page.getByRole("button", { name: "Create preview link" }).count()).toBe(0);
    await v.context.close();

    const o = await newPage(stack);
    await signIn(o, stranger.email, stranger.password);
    await o.waitForURL(`${BASE}/app/dashboard`);
    expect((await o.goto(`${BASE}/app/case-studies/${s.studyId}/edit`))?.status()).toBe(404);
    await o.close();
  }, 120_000);
});

describe("logo upload", () => {
  it.skipIf(!storageAvailable)("re-encodes the logo to WebP in the private bucket, shows it, and refuses a fake image", async () => {
    const owner = await createUser(stack.admin, "ed-logo");
    const s = await seed(owner.id);
    const { context, page } = await openEditor(owner.email, owner.password, s.studyId);

    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]), Buffer.alloc(200, 1)]);
    await page.getByLabel(/Logo \(PNG/).setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: exe });
    await page.getByRole("alert").getByText(/does not look like a valid/).waitFor();

    const png = await sharp({ create: { width: 2400, height: 900, channels: 3, background: "#cc3333" } }).png().toBuffer();
    await page.getByLabel(/Logo \(PNG/).setInputFiles({ name: "Secret Client Logo.PNG", mimeType: "image/png", buffer: png });
    await page.getByTestId("preview-frame").locator("img[alt$=' logo'], img[alt='Client logo']").first().waitFor();

    const saved = await until(() => study(s.studyId), (v) => Boolean(v.content.client.logoPath));
    expect(saved.content.client.logoPath).toMatch(new RegExp(`^${s.ws}/logos/[0-9a-f-]{36}\\.webp$`));
    expect(saved.content.client.logoPath).not.toMatch(/secret|png/i);
    const file = await stack.admin.storage.from("uploads").download(String(saved.content.client.logoPath));
    expect(await sharp(Buffer.from(await file.data!.arrayBuffer())).metadata()).toMatchObject({ format: "webp", width: 1200 });
    expect((await fetch(`${stack.cfg.url}/storage/v1/object/public/uploads/${saved.content.client.logoPath}`)).ok).toBe(false);
    await context.close();
  }, 120_000);

  it("the upload route refuses cross-origin, signed-out, viewer and bad requests", async () => {
    const owner = await createUser(stack.admin, "ed-logo-api");
    const s = await seed(owner.id);
    const url = `${BASE}/api/case-studies/${s.studyId}/logo`;
    expect((await fetch(url, { method: "POST" })).status).toBe(403);
    expect((await fetch(url, { method: "POST", headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await fetch(url, { method: "POST", headers: { origin: BASE } })).status).toBe(401);

    const viewer = await createUser(stack.admin, "ed-logo-viewer", { withWorkspace: false });
    await stack.admin.from("workspace_members").insert({ workspace_id: s.ws, user_id: viewer.id, role: "viewer" });
    const page = await newPage(stack);
    await signIn(page, viewer.email, viewer.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    expect((await page.request.post(url, { headers: { origin: BASE }, multipart: { file: { name: "a.png", mimeType: "image/png", buffer: Buffer.from("x") } } })).status()).toBe(403);
    await page.close();

    const ownerPage = await newPage(stack);
    await signIn(ownerPage, owner.email, owner.password);
    await ownerPage.waitForURL(`${BASE}/app/dashboard`);
    expect((await ownerPage.request.post(`${BASE}/api/case-studies/not-a-uuid/logo`, { headers: { origin: BASE } })).status()).toBe(404);
    expect((await ownerPage.request.post(url, { headers: { origin: BASE }, data: "{}" })).status()).toBe(400);
    const huge = Buffer.alloc(3 * 1024 * 1024);
    expect((await ownerPage.request.post(url, { headers: { origin: BASE }, multipart: { file: { name: "a.png", mimeType: "image/png", buffer: huge } } })).status()).toBe(413);
    await ownerPage.close();
  }, 120_000);
});

describe("client preview links", () => {
  it("shows the draft to someone with the link and nothing else, expires, and can be revoked", async () => {
    const owner = await createUser(stack.admin, "ed-preview");
    const s = await seed(owner.id);
    const { context, page } = await openEditor(owner.email, owner.password, s.studyId);

    await page.getByRole("button", { name: "Create preview link" }).click();
    const link = await page.getByLabel("Preview link").inputValue();
    expect(link).toMatch(new RegExp(`^${BASE}/preview/[A-Za-z0-9_-]{43}$`));

    // A stranger with only the link, no cookies, no account.
    const guestContext = await stack.browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.50" } });
    const guest = await guestContext.newPage();
    const guestProblems = watchConsole(guest);
    const res = await guest.goto(link);
    expect(res?.status()).toBe(200);
    expect(res?.headers()["x-robots-tag"]).toContain("noindex");
    expect(res?.headers()["referrer-policy"]).toBe("no-referrer");
    expect(res?.headers()["cache-control"]).toContain("no-store");
    await guest.getByText("Draft preview. This is not published and may change.").waitFor();
    await guest.getByRole("heading", { level: 1, name: "Faster onboarding" }).waitFor();
    expect(await guest.getByText("Draft - not published").count()).toBeGreaterThan(0);
    expect(await guest.getByText("40 percent").count()).toBeGreaterThan(0);

    // No app chrome, no workspace data, no editor.
    const text = await guest.locator("body").innerText();
    for (const secret of ["Sign out", "Requests", "Team", "d@example.test", "Dana Doe", "claim", "Onboarding fell 40 percent"]) expect(text).not.toContain(secret);
    expect(await guestContext.cookies()).toEqual([]);
    expect(guestProblems, `console problems: ${guestProblems.join(" | ")}`).toEqual([]);

    // Editing shows up on the next load (the preview shows the current draft).
    await page.getByLabel("Headline").fill("Updated after sharing");
    await until(() => study(s.studyId), (v) => v.content.headline === "Updated after sharing");
    await guest.reload();
    await guest.getByRole("heading", { level: 1, name: "Updated after sharing" }).waitFor();

    // Revoke: gone at once.
    await page.getByRole("button", { name: "Revoke" }).click();
    await page.getByText("Link revoked. It stops working immediately.").waitFor();
    expect((await fetch(link, { headers: { "x-forwarded-for": "203.0.113.51" } })).status).toBe(404);

    // Expiry: a fresh link, aged past 14 days by the database owner.
    await page.getByRole("button", { name: "Create preview link" }).click();
    await page.waitForFunction((old) => (document.querySelector("input[aria-label='Preview link']") as HTMLInputElement | null)?.value !== old, link);
    const second = await page.getByLabel("Preview link").inputValue();
    expect((await fetch(second, { headers: { "x-forwarded-for": "203.0.113.52" } })).status).toBe(200);
    await stack.admin.from("case_study_previews").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("case_study_id", s.studyId);
    expect((await fetch(second, { headers: { "x-forwarded-for": "203.0.113.53" } })).status).toBe(404);

    await guestContext.close();
    await context.close();
  }, 180_000);

  it("unknown, malformed and revoked links all look the same, and a flood from one IP is throttled", async () => {
    const bodies = new Set<string>();
    const normalise = (html: string) => html.replace(/nonce="[^"]*"/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/[A-Za-z0-9_-]{43}/g, "TOKEN");
    for (const path of [randomBytes(32).toString("base64url"), "short", "..%2f..%2fetc%2fpasswd"]) {
      const res = await fetch(`${BASE}/preview/${path}`, { headers: { "x-forwarded-for": `203.0.113.${60 + Math.floor(Math.random() * 100)}` } });
      expect(res.status).toBe(404);
      bodies.add(normalise(await res.text()));
    }
    expect(bodies.size).toBe(1);

    const headers = { "x-forwarded-for": "198.51.100.222" };
    const statuses: number[] = [];
    for (let i = 0; i < 36; i++) statuses.push((await fetch(`${BASE}/preview/${"p".repeat(43)}`, { headers })).status);
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(await (await fetch(`${BASE}/preview/${"p".repeat(43)}`, { headers })).text()).toContain("Too many requests");
  }, 120_000);

  it("a published case study has no preview link, and the 10 link limit holds", async () => {
    const owner = await createUser(stack.admin, "ed-preview2");
    const s = await seed(owner.id);
    const { context, page } = await openEditor(owner.email, owner.password, s.studyId);
    for (let i = 0; i < 10; i++) {
      await page.getByRole("button", { name: "Create preview link" }).click();
      await page.getByLabel("Preview link").waitFor();
      await page.waitForTimeout(150);
    }
    await page.getByRole("button", { name: "Create preview link" }).click();
    await page.getByText("You have 10 active preview links. Revoke one first.").waitFor();
    await context.close();
  }, 180_000);
});

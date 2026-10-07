import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { BASE, createUser, signIn, startStack, stopStack, watchConsole, type Stack } from "./harness";

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 120_000);
afterAll(async () => {
  await stopStack(stack);
});

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, seconds = 15): Promise<T> {
  const end = Date.now() + seconds * 1000;
  let v = await read();
  while (!done(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 500));
    v = await read();
  }
  return v;
}

describe("demo editor", () => {
  it("creates a demo, uploads and confirms an image, autosaves steps, and only serves the image publicly once published", async () => {
    const owner = await createUser(stack.admin, "dm-e2e-owner");
    const other = await createUser(stack.admin, "dm-e2e-other");
    const ctx = await stack.browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.77" } });
    const page = await ctx.newPage();
    const problems = watchConsole(page);
    await signIn(page, owner.email, owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);

    // create
    await page.goto(`${BASE}/app/demos`);
    await page.getByLabel("New demo").fill("Onboarding walkthrough");
    await page.getByRole("button", { name: "Create demo" }).click();
    await page.waitForURL(/\/app\/demos\/[0-9a-f-]{36}$/);
    const demoId = page.url().split("/").pop()!;

    // upload an image; it needs confirming
    const png = await sharp({ create: { width: 640, height: 400, channels: 3, background: "#336699" } }).png().toBuffer();
    await page.getByLabel("Upload an image").setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: png });
    await page.getByText("· needs confirming").waitFor();
    const { data: assets } = await stack.admin.from("demo_assets").select("id, flagged").eq("demo_id", demoId);
    expect(assets).toHaveLength(1);
    const assetId = String(assets![0].id);
    expect(assets![0].flagged).toBe(true);

    // a screenshot step and a chat step
    await page.getByRole("button", { name: "Add screenshot step" }).click();
    await page.getByLabel("Tooltip title").fill("Open the reports tab");
    await page.getByRole("button", { name: "Add simulated chat" }).click();
    await page.getByLabel("Message 1 text").fill("Where is my refund?");
    await page.getByLabel("Message 2 text").fill("Let me check that.");
    await page.getByText("Simulated example").first().waitFor();

    // markup never reaches the database
    await page.getByLabel("Message 1 text").fill("<img src=x onerror=alert(1)>");
    await page.getByText("Not saved").waitFor({ timeout: 10_000 });
    await page.getByLabel("Message 1 text").fill("Where is my refund?");
    await page.getByText("Saved", { exact: true }).waitFor({ timeout: 10_000 });
    const saved = await until(async () => (await stack.admin.from("demos").select("content").eq("id", demoId).single()).data?.content as { scenes: Array<{ type: string }> }, (c) => c.scenes?.length === 2);
    expect(saved.scenes.map((s) => s.type)).toEqual(["screenshot", "chat"]);

    // an unconfirmed image blocks publishing
    await page.getByLabel("Demo name").waitFor();
    await page.getByLabel(/This demo is a true example/).check();
    await page.getByLabel(/I checked every image/).check();
    await page.getByLabel("Page address").fill("onboarding-tour");
    await page.getByText("Saved", { exact: true }).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Publish demo" }).click();
    await page.getByText("Confirm or blur every image before publishing.").waitFor();

    // before publishing, the image is private
    const anon = await stack.browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.78" } });
    expect((await anon.request.get(`${BASE}/api/demo-asset/${assetId}`)).status()).toBe(404);
    // another workspace's member cannot see the demo or the image either
    const otherCtx = await stack.browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.79" } });
    const otherPage = await otherCtx.newPage();
    await signIn(otherPage, other.email, other.password);
    await otherPage.waitForURL(`${BASE}/app/dashboard`);
    expect((await otherPage.goto(`${BASE}/app/demos/${demoId}`))?.status()).toBe(404);
    expect((await otherCtx.request.get(`${BASE}/api/demo-asset/${assetId}`)).status()).toBe(404);

    // confirm the image, publish
    await page.getByRole("button", { name: "Nothing private here" }).click();
    await page.getByText("· confirmed").waitFor();
    await page.getByRole("button", { name: "Publish demo" }).click();
    await page.getByRole("button", { name: "Unpublish" }).waitFor();

    // now visitors can see it, and only with safe headers
    const live = await anon.request.get(`${BASE}/api/demo-asset/${assetId}`);
    expect(live.status()).toBe(200);
    expect(live.headers()["content-type"]).toBe("image/webp");
    expect(live.headers()["x-content-type-options"]).toBe("nosniff");
    // while live the editor is locked
    await page.getByText("This demo is live.").waitFor();

    expect(problems.filter((p) => !/401|403|404|409|400/.test(p))).toEqual([]);
    await ctx.close();
    await anon.close();
    await otherCtx.close();
  }, 180_000);
});

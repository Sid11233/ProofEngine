import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, createUser, newPage, signIn, startStack, stopStack, watchConsole, type Stack } from "./harness";
import { loadLocalConfig, makeClient } from "../supabase/tests/isolation/harness";

let stack: Stack;
let platform: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  platform = await createUser(makeClient(loadLocalConfig(), "service"), "motion-platform");
  stack = await startStack({ PLATFORM_ADMIN_EMAILS: platform.email });
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

describe("the motion foundation", () => {
  it("shows the lab to operators only, with a working demo and no CSP errors", async () => {
    const stranger = await createUser(stack.admin, "motion-stranger");
    const other = await newPage(stack);
    await signIn(other, stranger.email, stranger.password);
    await other.waitForURL(`${BASE}/app/dashboard`);
    expect((await other.goto(`${BASE}/dev/motion`))?.status()).toBe(404);

    const page = await newPage(stack);
    const problems = watchConsole(page);
    await signIn(page, platform.email, platform.password);
    await page.waitForURL(/\/app\/|\/onboarding/);
    expect((await page.goto(`${BASE}/dev/motion`))?.status()).toBe(200);
    await page.getByRole("heading", { name: "Motion lab" }).waitFor();
    await page.locator('[data-anim="G-22"] li').first().waitFor();
    expect(await page.locator('[data-anim="G-22"] li').count()).toBe(10);
    expect(await page.locator('[data-anim="G-15"]').count()).toBe(1);
    expect(problems).toEqual([]);
  }, 120_000);

  it("saves the Reduce motion setting, which overrides the device setting and makes CSS motion instant", async () => {
    const user = await createUser(stack.admin, "motion-user");
    const page = await newPage(stack);
    await signIn(page, user.email, user.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.goto(`${BASE}/app/settings/motion`);
    await page.getByRole("heading", { name: "Motion" }).waitFor();

    expect(await page.locator("html").getAttribute("data-motion")).toBe("system");

    await page.getByRole("radio", { name: /^Reduce motion/ }).check();
    await page.getByText("Motion is reduced right now.").waitFor();
    expect(await page.locator("html").getAttribute("data-motion")).toBe("reduce");
    const cookie = (await page.context().cookies()).find((c) => c.name === "pe_motion");
    expect(cookie?.value).toBe("reduce");

    // It sticks after a reload, and the server renders the attribute (no flash).
    await page.reload();
    expect(await page.locator("html").getAttribute("data-motion")).toBe("reduce");
    await page.getByRole("radio", { name: /^Allow motion/ }).check();
    expect(await page.locator("html").getAttribute("data-motion")).toBe("full");
  }, 120_000);

  it("follows the device's reduced-motion setting when nothing is chosen", async () => {
    const user = await createUser(stack.admin, "motion-device");
    const context = await stack.browser.newContext({ reducedMotion: "reduce", extraHTTPHeaders: { "x-forwarded-for": "198.51.100.77" } });
    const page = await context.newPage();
    await signIn(page, user.email, user.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.goto(`${BASE}/app/settings/motion`);
    await page.getByText("Motion is reduced right now.").waitFor();
    // The safety net makes transitions effectively instant.
    const duration = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.className = "anim-press";
      document.body.appendChild(probe);
      return getComputedStyle(probe).transitionDuration;
    });
    expect(parseFloat(duration)).toBeLessThan(0.001);
    // An explicit "Allow motion" wins over the device.
    await page.getByRole("radio", { name: /^Allow motion/ }).check();
    await page.getByText("Animations are on.").waitFor();
    await context.close();
  }, 120_000);
});

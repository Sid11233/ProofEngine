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

describe("the overlay and navigation animations", () => {
  async function lab(label: string) {
    const page = await newPage(stack);
    const problems = watchConsole(page);
    await signIn(page, platform.email, platform.password);
    await page.waitForURL(/\/app\/|\/onboarding/);
    await page.goto(`${BASE}/dev/motion`);
    await page.getByRole("heading", { name: "Motion lab" }).waitFor();
    void label;
    return { page, problems };
  }

  it("a dialog moves focus in, keeps Tab inside, closes on Escape and gives focus back", async () => {
    const { page, problems } = await lab("dialog");
    const opener = page.getByRole("button", { name: "Open dialog" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "A dialog" });
    await dialog.waitFor();
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    expect(await opener.evaluate((el) => el === document.activeElement)).toBe(true);
    expect(problems).toEqual([]);
  }, 120_000);

  it("tabs follow the arrow keys, and a popover closes on Escape", async () => {
    const { page } = await lab("tabs");
    const tabs = page.getByRole("tab");
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await page.getByText("Second panel").waitFor();
    expect(await page.getByRole("tab", { name: "Second" }).getAttribute("aria-selected")).toBe("true");
    await page.keyboard.press("End");
    await page.getByText("Third panel").waitFor();
    await page.keyboard.press("Home");
    await page.getByText("First panel").waitFor();

    const trigger = page.getByRole("button", { name: "Open popover" });
    await trigger.click();
    await page.getByText("Hello from a popover.").waitFor();
    expect(await trigger.getAttribute("aria-expanded")).toBe("true");
    await page.keyboard.press("Escape");
    await page.getByText("Hello from a popover.").waitFor({ state: "detached" });
    expect(await trigger.getAttribute("aria-expanded")).toBe("false");
  }, 120_000);

  it("toasts are announced, dismiss themselves and can be closed; the button shows loading then done", async () => {
    const { page } = await lab("toast");
    await page.getByRole("button", { name: "Success toast" }).click();
    const toast = page.getByRole("status").filter({ hasText: "Saved your changes" });
    await toast.waitFor();
    await toast.getByRole("button", { name: "Dismiss" }).click();
    await toast.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Error toast" }).click();
    await page.getByRole("alert").filter({ hasText: "That did not work" }).waitFor();

    await page.getByRole("button", { name: "Save" }).click();
    await page.locator('[data-anim="G-16"][aria-busy="true"]').waitFor();
    await page.locator('[data-anim="G-16"][aria-busy="false"]').waitFor();
  }, 120_000);

  it("the app has the nav pill, a bottom bar on phones, and honours reduced motion on route changes", async () => {
    const user = await createUser(stack.admin, "motion-nav");
    const context = await stack.browser.newContext({ viewport: { width: 390, height: 800 }, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.88" } });
    const page = await context.newPage();
    await signIn(page, user.email, user.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.locator('nav[data-anim="G-06"]').waitFor();
    await page.locator('nav[data-anim="G-06"] a[aria-current="page"]').waitFor();
    await page.locator('nav[data-anim="G-05"] a[aria-current="page"]').waitFor();
    await page.locator('nav[data-anim="G-06"]').getByRole("link", { name: "Requests" }).click();
    await page.waitForURL(`${BASE}/app/requests`);
    expect(await page.locator('nav[data-anim="G-06"] a[aria-current="page"]').innerText()).toContain("Requests");
    // The page itself carries the route transition.
    expect(await page.locator('[data-anim="G-01"]').count()).toBe(1);
    await context.close();

    const reduced = await stack.browser.newContext({ reducedMotion: "reduce", extraHTTPHeaders: { "x-forwarded-for": "198.51.100.89" } });
    const rp = await reduced.newPage();
    await signIn(rp, user.email, user.password);
    await rp.waitForURL(`${BASE}/app/dashboard`);
    const animation = await rp.evaluate(() => { const el = document.querySelector('[data-anim="G-01"]'); return el ? getComputedStyle(el).animationName + " " + getComputedStyle(el).animationDuration : ""; });
    expect(animation).toBe("anim-route-fade 0.12s");
    await reduced.close();
  }, 120_000);
});

describe("the Attract Studio loader", () => {
  it("plays in the lab, and stands still with reduced motion", async () => {
    const page = await newPage(stack);
    await signIn(page, platform.email, platform.password);
    await page.waitForURL(/\/app\/|\/onboarding/);
    await page.goto(`${BASE}/dev/motion`);
    const loader = page.locator('[data-anim="S-02"][role="status"]').first();
    await loader.waitFor();
    expect(await loader.locator(".as-Min").count()).toBe(1);
    expect(await loader.locator(".as-LT").count()).toBe(7);
    expect(await loader.evaluate((el) => getComputedStyle(el.querySelector(".as-Min")!).animationName)).toBe("as-in");

    await page.getByRole("radio", { name: /^Reduce motion/ }).check();
    expect(await loader.evaluate((el) => getComputedStyle(el.querySelector(".as-Min")!).animationName)).toBe("none");
    expect(await loader.evaluate((el) => getComputedStyle(el.querySelector(".as-LV")!).animationName)).toBe("none");
  }, 120_000);

  it("shows while a clicked link waits for its page, with no card behind it, never blocks clicks, and goes away", async () => {
    const user = await createUser(stack.admin, "motion-loader");
    const page = await newPage(stack);
    await signIn(page, user.email, user.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.goto(`${BASE}/app/requests`);
    await page.getByRole("heading", { name: "Requests" }).waitFor();
    // A page without its own loading screen, made slow: hold back its data for a moment.
    await page.route("**/app/requests/new**", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
    await page.getByRole("link", { name: "New request" }).click();
    const loader = page.getByRole("status").filter({ hasText: "Opening the page" });
    await loader.waitFor();
    const wrapper = page.locator('[data-anim="S-02"]').first();
    expect(await wrapper.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
    // No card: the wrapper and the loader have no background, border or shadow.
    for (const el of [wrapper, loader]) {
      const style = await el.evaluate((node) => { const c = getComputedStyle(node); return { bg: c.backgroundColor, border: c.borderTopWidth, shadow: c.boxShadow }; });
      expect(style).toEqual({ bg: "rgba(0, 0, 0, 0)", border: "0px", shadow: "none" });
    }
    expect(await page.locator("html").getAttribute("data-navigating")).toBe("true");
    await page.waitForURL(`${BASE}/app/requests/new`);
    await loader.waitFor({ state: "detached" });
    expect(await page.locator("html").getAttribute("data-navigating")).toBeNull();
  }, 120_000);

  it("settings pages load like the dashboard: the logo animation over a page-shaped placeholder", async () => {
    const user = await createUser(stack.admin, "motion-settings");
    const page = await newPage(stack);
    await signIn(page, user.email, user.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.goto(`${BASE}/app/settings/wall`);
    await page.getByRole("heading", { name: "Wall of proof" }).waitFor();
    await page.route("**/app/settings/security**", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Security" }).click();
    const loading = page.locator('[aria-busy="true"]').filter({ has: page.locator('[data-anim="S-02"]') });
    await loading.waitFor();
    expect(await loading.locator('[data-anim="G-27"]').count()).toBeGreaterThan(0);
    await page.getByRole("heading", { name: /Security|two-factor/i }).first().waitFor();
    await loading.waitFor({ state: "detached" });
  }, 120_000);
});

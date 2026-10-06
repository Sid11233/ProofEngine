import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { BASE, createUser, newPage, signIn, startStack, stopStack, type Stack } from "./harness";

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

async function signedIn(label: string) {
  const user = await createUser(stack.admin, label);
  const { data: m } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", user.id).single();
  await stack.admin.from("workspaces").update({ name: "Secret Workspace Name" }).eq("id", m?.workspace_id);
  const page = await newPage(stack);
  await signIn(page, user.email, user.password);
  await page.waitForURL(`${BASE}/app/dashboard`);
  return { user, page, context: page.context() };
}

const controlled = (page: Awaited<ReturnType<typeof newPage>>) => page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return { scope: new URL(reg.scope).pathname, controlled: Boolean(navigator.serviceWorker.controller) };
});

describe("installability", () => {
  it("serves a complete manifest and icons that exist, with iOS tags, and Chrome reports no installability problems", async () => {
    const { page } = await signedIn("pwa-manifest");
    const res = await fetch(`${BASE}/manifest.webmanifest`);
    expect(res.status).toBe(200);
    const m = await res.json();
    expect(m).toMatchObject({ start_url: "/app/dashboard", display: "standalone", theme_color: "#171717" });
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    const purposes = m.icons.map((i: { sizes: string; purpose?: string }) => `${i.sizes}:${i.purpose ?? "any"}`);
    expect(purposes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
    for (const icon of m.icons) {
      const r = await fetch(`${BASE}${icon.src}`);
      expect(r.status, icon.src).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/png");
    }
    expect((await fetch(`${BASE}/icons/apple-touch-icon.png`)).status).toBe(200);

    await page.goto(`${BASE}/app/dashboard`);
    expect(await page.locator('link[rel="manifest"]').getAttribute("href")).toBe("/manifest.webmanifest");
    expect(await page.locator('link[rel="apple-touch-icon"]').getAttribute("href")).toContain("apple-touch-icon");
    expect(await page.locator('meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"]').count()).toBeGreaterThan(0);
    expect(await page.locator('meta[name="theme-color"]').count()).toBeGreaterThan(0);

    // Chrome's own installability check (what Lighthouse's PWA audit reads).
    await controlled(page);
    const cdp = await page.context().newCDPSession(page);
    const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as { installabilityErrors: Array<{ errorId: string }> };
    expect(installabilityErrors.map((e) => e.errorId), "Chrome reports installability errors").toEqual([]);
  }, 120_000);
});

describe("service worker", () => {
  it("is served fresh from the app origin, is scoped to /app/, and the interview page is outside it", async () => {
    const res = await fetch(`${BASE}/sw.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    const { page } = await signedIn("pwa-scope");
    await page.goto(`${BASE}/app/dashboard`);
    expect((await controlled(page)).scope).toBe("/app/");
    // An interview link is never controlled by the worker.
    await page.goto(`${BASE}/i/${randomBytes(32).toString("base64url")}`);
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(false);
  }, 120_000);

  it("shows only the branded offline page when offline, with no private data, and caches only static files", async () => {
    const { page, context } = await signedIn("pwa-offline");
    await page.goto(`${BASE}/app/dashboard`);
    await page.getByText("Secret Workspace Name").first().waitFor();
    await page.reload(); // now controlled by the worker
    await controlled(page);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

    await context.setOffline(true);
    await page.goto(`${BASE}/app/dashboard`).catch(() => undefined);
    await page.getByRole("heading", { name: "You are offline" }).waitFor();
    const text = await page.locator("body").innerText();
    expect(text).not.toContain("Secret Workspace Name");
    expect(text).not.toContain("@example.test");
    await context.setOffline(false);

    // What the worker stored: static assets only (no HTML pages, no API responses, nothing private).
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) urls.push(new URL(r.url).pathname);
      return urls;
    });
    expect(cached.length).toBeGreaterThan(0);
    for (const path of cached) expect(path, `cached something that is not a static file: ${path}`).toMatch(/^\/(_next\/static\/|icons\/|offline\.(html|css)$)/);
    expect(cached.some((p) => p.startsWith("/app") || p.startsWith("/api") || p.startsWith("/i/") || p.startsWith("/preview") || p.startsWith("/approve"))).toBe(false);
  }, 120_000);

  it("clears every cache on sign out, and the next offline visit shows nothing private", async () => {
    const { page, context } = await signedIn("pwa-signout");
    await page.goto(`${BASE}/app/dashboard`);
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    expect(await page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(`${BASE}/login`);
    expect(await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("pe-")).length), "caches survived sign out").toBe(0);

    await context.setOffline(true);
    await page.goto(`${BASE}/app/dashboard`).catch(() => undefined);
    const text = await page.locator("body").innerText();
    expect(text).not.toContain("Secret Workspace Name");
    await context.setOffline(false);
  }, 120_000);
});

describe("install prompt", () => {
  it("is only in the signed-in app, can be dismissed, and remembers the dismissal", async () => {
    const { page } = await signedIn("pwa-install");
    await page.goto(`${BASE}/app/dashboard`);
    // Chrome's install event is not fired in headless runs, so dispatch one the way the browser would.
    const fire = () => page.evaluate(() => {
      const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };
      e.prompt = async () => undefined;
      e.userChoice = Promise.resolve({ outcome: "dismissed" });
      window.dispatchEvent(e);
    });
    // The page must be hydrated before it listens, so keep offering the event until the button shows.
    for (let i = 0; i < 20 && (await page.getByRole("button", { name: "Install app" }).count()) === 0; i++) {
      await fire();
      await page.waitForTimeout(250);
    }
    await page.getByRole("button", { name: "Install app" }).waitFor();
    await page.getByRole("button", { name: "Dismiss install suggestion" }).click();
    expect(await page.getByRole("button", { name: "Install app" }).count()).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem("pe-install-dismissed"))).toBe("1");

    await page.reload();
    await page.waitForTimeout(1500);
    await fire();
    await page.waitForTimeout(500);
    expect(await page.getByRole("button", { name: "Install app" }).count(), "dismissal was forgotten").toBe(0);

    const out = await newPage(stack);
    await out.goto(`${BASE}/login`);
    expect(await out.getByRole("button", { name: "Install app" }).count()).toBe(0);
  }, 120_000);
});

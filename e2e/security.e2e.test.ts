import { afterAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { BASE, createUser, newPage, signIn, startStack, stopStack, type Stack } from "./harness";

let stack: Stack | undefined;
afterAll(async () => {
  await stopStack(stack);
});

const NEW_PASSWORD = "a-brand-new-password-98765";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

describe("what the browser can reach", () => {
  it("session cookies are HttpOnly and SameSite=Lax, and no script can read the session", async () => {
    stack = await startStack();
    const user = await createUser(stack.admin, "sec-cookie");
    const page = await newPage(stack);
    await signIn(page, user.email, user.password);
    await page.waitForURL(`${BASE}/app/dashboard`);

    const cookies = (await page.context().cookies()).filter((c) => c.name.startsWith("sb-"));
    expect(cookies.length, "no session cookie was set").toBeGreaterThan(0);
    for (const c of cookies) {
      expect(c.httpOnly, `${c.name} is readable by JavaScript`).toBe(true);
      expect(c.sameSite).toBe("Lax");
    }
    expect(await page.evaluate(() => document.cookie)).not.toMatch(/sb-/);
    expect(await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => /sb-|supabase|token/i.test(k)))).toEqual([]);
    await page.close();
  }, 120_000);

  it("the built client bundle has no source maps and none of the server secrets", () => {
    const staticDir = join(process.cwd(), ".next", "static");
    const all = files(staticDir);
    expect(all.filter((f) => f.endsWith(".map")), "source maps are published").toEqual([]);

    const secrets = [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.ANTHROPIC_API_KEY, process.env.RESEND_API_KEY, process.env.TURNSTILE_SECRET_KEY, process.env.STRIPE_SECRET_KEY].filter((v): v is string => Boolean(v && v.length > 12));
    expect(secrets.length).toBeGreaterThan(0);
    for (const file of all.filter((f) => /\.(js|css|html|json)$/.test(f))) {
      const text = readFileSync(file, "utf8");
      for (const secret of secrets) expect(text.includes(secret), `a server secret is inside ${file}`).toBe(false);
      expect(text, `${file} mentions the service role`).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it("sends the security headers on every kind of route, and no CORS headers anywhere", async () => {
    const token = "a".repeat(43);
    for (const path of ["/", "/login", "/signup", `/i/${token}`, `/preview/${token}`, "/nonexistent", "/api/interview/start", "/api/case-studies/generate"]) {
      const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
      expect(res.headers.get("x-frame-options"), path).toBe("DENY");
      expect(res.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(res.headers.get("strict-transport-security"), path).toContain("max-age=");
      expect(res.headers.get("cross-origin-opener-policy"), path).toBe("same-origin");
      expect(res.headers.get("content-security-policy"), path).toContain("frame-ancestors 'none'");
      expect(res.headers.get("x-powered-by"), path).toBeNull();
      expect(res.headers.get("access-control-allow-origin"), path).toBeNull();
    }
    for (const path of ["/api/interview/start", "/api/case-studies/generate", `/api/case-studies/${crypto.randomUUID()}/logo`]) {
      const res = await fetch(`${BASE}${path}`);
      expect(res.headers.get("cache-control"), `${path} may be cached`).toContain("no-store");
    }
    const preflight = await fetch(`${BASE}/api/interview/message`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("every app page sends signed-out visitors to the login page", async () => {
    for (const path of ["/app/dashboard", "/app/requests", "/app/requests/new", "/app/case-studies", "/app/settings/team", "/app/settings/security", "/onboarding"]) {
      const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
      expect(res.status, path).toBe(307);
      expect(new URL(res.headers.get("location") ?? "", BASE).pathname, path).toBe("/login");
    }
  });
});

describe("changing the password needs a recent sign-in", () => {
  const signInWorks = async (cfg: Stack["cfg"], email: string, password: string) => {
    const client = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } });
    return !(await client.auth.signInWithPassword({ email, password })).error;
  };

  it("an older session cannot change it: the password stays as it was", async () => {
    await stopStack(stack);
    stack = await startStack({ REAUTH_MAX_AGE_SECONDS: "2" });
    const user = await createUser(stack.admin, "sec-stale");
    const page = await newPage(stack);
    await signIn(page, user.email, user.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.waitForTimeout(3500); // the sign-in is now "old"

    await page.goto(`${BASE}/reset-password`);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Update password" }).click();
    await page.getByText(/session is too old to change the password/).waitFor();

    expect(await signInWorks(stack.cfg, user.email, user.password), "the original password stopped working").toBe(true);
    expect(await signInWorks(stack.cfg, user.email, NEW_PASSWORD), "the stale session changed the password").toBe(false);
    await page.close();
  }, 120_000);

  it("a fresh sign-in can change it", async () => {
    await stopStack(stack);
    stack = await startStack({ REAUTH_MAX_AGE_SECONDS: "600" });
    const user = await createUser(stack.admin, "sec-fresh");
    const page = await newPage(stack);
    await signIn(page, user.email, user.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.goto(`${BASE}/reset-password`);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Update password" }).click();
    await page.waitForURL(`${BASE}/app/dashboard`);
    expect(await signInWorks(stack.cfg, user.email, NEW_PASSWORD)).toBe(true);
    await page.close();
  }, 120_000);
});

describe("rate limits cannot be dodged by forging the client address", () => {
  it("in production without a trusted proxy, rotating X-Forwarded-For does not reset the limit", async () => {
    await stopStack(stack);
    // A production server that is NOT behind Vercel or another proxy we control.
    stack = await startStack({ TRUST_PROXY_HEADERS: "0" });
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) {
      const res = await fetch(`${BASE}/i/${"b".repeat(43)}`, { headers: { "x-forwarded-for": `203.0.113.${i + 1}`, "x-real-ip": `198.51.100.${i + 1}` } });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    const limited = await fetch(`${BASE}/i/${"b".repeat(43)}`, { headers: { "x-forwarded-for": "192.0.2.250" } });
    expect(await limited.text(), "forged addresses gave the client a fresh limit every time").toContain("Too many requests");
  }, 120_000);
});

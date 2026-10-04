import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, createUser, newPage, signIn, startStack, statusText, stopStack, watchConsole, type Stack } from "./harness";

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

describe("authentication in a real browser", () => {
  it("sends an anonymous visitor to login and remembers the destination", async () => {
    const page = await newPage(stack);
    await page.goto(`${BASE}/app/dashboard`);
    expect(new URL(page.url()).pathname).toBe("/login");
    expect(new URL(page.url()).searchParams.get("next")).toBe("/app/dashboard");
    await page.close();
  });

  it("signs in, lands on the dashboard, and signs out, with no CSP violations", async () => {
    const user = await createUser(stack.admin, "login");
    const page = await newPage(stack);
    const problems = watchConsole(page);

    await page.goto(`${BASE}/app/dashboard`);
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.getByRole("heading", { name: "Dashboard" }).waitFor();

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(`${BASE}/login`);

    // Signed out means signed out: the dashboard is locked again.
    await page.goto(`${BASE}/app/dashboard`);
    expect(new URL(page.url()).pathname).toBe("/login");

    expect(problems, `console problems: ${problems.join(" | ")}`).toEqual([]);
    await page.close();
  });

  it("gives the same message for a wrong password and an unknown email", async () => {
    const user = await createUser(stack.admin, "generic");
    const page = await newPage(stack);

    await signIn(page, user.email, "definitely-the-wrong-password");
    const wrongPassword = await statusText(page);

    await signIn(page, "nobody-here@example.test", "definitely-the-wrong-password");
    const unknownEmail = await statusText(page);

    expect(wrongPassword).toBe("Invalid email or password.");
    expect(unknownEmail).toBe(wrongPassword);
    await page.close();
  });

  it("throttles repeated attempts on one email (5 per 15 minutes)", async () => {
    const user = await createUser(stack.admin, "throttle");
    const page = await newPage(stack);

    for (let i = 0; i < 5; i++) {
      await signIn(page, user.email, "wrong-password-attempt");
      await page.getByText("Invalid email or password.").waitFor();
    }
    // Even the correct password is refused once the limit is hit.
    await signIn(page, user.email, user.password);
    await page.getByText(/too many attempts/i).waitFor();
    expect(new URL(page.url()).pathname).toBe("/login");
    await page.close();
  });

  it.each(["//evil.example", "https://evil.example/app", "/\\evil.example"])(
    "ignores a hostile next parameter (%s)",
    async (next) => {
      const user = await createUser(stack.admin, "redirect");
      const page = await newPage(stack);
      await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
      await page.getByLabel("Email").fill(user.email);
      await page.getByLabel("Password").fill(user.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(`${BASE}/app/dashboard`);
      await page.close();
    },
  );

  it("bounces a signed-in user away from the login page", async () => {
    const user = await createUser(stack.admin, "bounce");
    const page = await newPage(stack);
    await signIn(page, user.email, user.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.goto(`${BASE}/login`);
    expect(new URL(page.url()).pathname).toBe("/app/dashboard");
    await page.close();
  });

  it("serves security headers and a nonce-based CSP", async () => {
    const res = await fetch(`${BASE}/login`);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).not.toContain("unsafe-inline");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });
});

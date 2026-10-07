import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { BASE, createUser, newPage, signIn, startStack, stopStack, totp, watchConsole, type Stack, signOut } from "./harness";

let stack: Stack;

// A short "recent sign-in" window lets the test see the re-authentication prompt (long enough to finish both steps).
beforeAll(async () => {
  stack = await startStack({ REAUTH_MAX_AGE_SECONDS: "15" });
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

/**
 * Types a code and submits it. `succeeded` resolves when the page shows the code
 * was accepted; if not, the next time step is tried (covers a step boundary).
 */
async function enterCode(
  secret: string,
  field: () => ReturnType<Page["getByLabel"]>,
  submit: () => ReturnType<Page["getByRole"]>,
  succeeded: (timeout: number) => Promise<unknown>,
) {
  for (const offset of [0, 1]) {
    await field().fill(totp(secret, offset));
    await submit().click();
    const ok = await succeeded(4000).then(() => true, () => false);
    if (ok) return;
  }
  throw new Error(`authenticator code was rejected twice`);
}

describe("two-factor authentication in a real browser", () => {
  it("enrols, then requires the code at sign-in, and re-checks identity before turning it off", async () => {
    const user = await createUser(stack.admin, "mfa");
    const page = await newPage(stack);
    const problems = watchConsole(page);

    // Owners without MFA see the nudge.
    await signIn(page, user.email, user.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.getByText(/Protect your workspace with two-factor authentication/i).waitFor();

    // Enrol.
    await page.goto(`${BASE}/app/settings/security`);
    await page.getByRole("button", { name: "Turn on two-factor authentication" }).click();
    const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
    expect(secret.length).toBeGreaterThanOrEqual(16);
    await page.getByLabel(/Enter the 6-digit code/).fill("000000");
    await page.getByRole("button", { name: "Verify and turn on" }).click();
    await page.getByText(/not valid/i).waitFor();
    await enterCode(
      secret,
      () => page.getByLabel(/Enter the 6-digit code/),
      () => page.getByRole("button", { name: "Verify and turn on" }),
      (timeout) => page.getByText("Two-factor authentication is on.", { exact: true }).waitFor({ timeout }),
    );

    // The banner is gone once MFA is on.
    await page.goto(`${BASE}/app/dashboard`);
    expect(await page.getByText(/Protect your workspace with two-factor authentication/i).count()).toBe(0);

    // Sign out and in again: the password alone must not be enough.
    await signOut(page);
    await page.waitForURL(`${BASE}/login`);
    await signIn(page, user.email, user.password);
    await page.waitForURL(/\/login\/mfa/);
    await page.goto(`${BASE}/app/dashboard`);
    expect(new URL(page.url()).pathname, "dashboard reachable without the second factor").toBe("/login/mfa");

    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await page.getByText(/not valid/i).waitFor();
    await enterCode(
      secret,
      () => page.getByLabel("6-digit code"),
      () => page.getByRole("button", { name: "Verify" }),
      (timeout) => page.waitForURL(`${BASE}/app/dashboard`, { timeout }),
    );

    // Turning MFA off is sensitive: after the 15 second window it asks for the password, then a code.
    await page.goto(`${BASE}/app/settings/security`);
    await page.waitForTimeout(16_000);
    await page.getByRole("button", { name: "Turn off two-factor authentication" }).click();
    await page.getByRole("group", { name: "Confirm it is you" }).waitFor();

    await page.getByLabel("Password").fill("wrong-password-here");
    await page.getByRole("button", { name: "Confirm" }).click();
    await page.getByText("Incorrect password.").waitFor();

    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Confirm" }).click();
    await page.getByLabel("6-digit code").waitFor();
    await enterCode(
      secret,
      () => page.getByLabel("6-digit code"),
      () => page.getByRole("button", { name: "Confirm" }),
      (timeout) => page.getByText("Two-factor authentication is off.", { exact: true }).waitFor({ timeout }),
    );

    expect(problems, `console problems: ${problems.join(" | ")}`).toEqual([]);
    await page.close();
  }, 120_000);
});

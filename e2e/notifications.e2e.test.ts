import { afterAll, describe, expect, it } from "vitest";
import webpush from "web-push";
import { BASE, createUser, newPage, signIn, startStack, stopStack, type Stack } from "./harness";

let stack: Stack | undefined;
afterAll(async () => {
  await stopStack(stack);
});

async function openSettings(withStack: Stack, label: string, { grant = false } = {}) {
  const user = await createUser(withStack.admin, label);
  const page = await newPage(withStack);
  // Count every permission request: the page must never ask on its own.
  await page.addInitScript(() => {
    (window as unknown as { __permissionAsks: number }).__permissionAsks = 0;
    if ("Notification" in window) {
      const original = Notification.requestPermission.bind(Notification);
      Notification.requestPermission = (...args) => {
        (window as unknown as { __permissionAsks: number }).__permissionAsks += 1;
        return original(...args);
      };
    }
  });
  // Headless Chromium always reports "denied"; present the state of a normal browser that has not been asked yet.
  if (grant) await page.addInitScript(() => Object.defineProperty(Notification, "permission", { get: () => "default" }));
  await signIn(page, user.email, user.password);
  await page.waitForURL(`${BASE}/app/dashboard`);
  await page.goto(`${BASE}/app/settings/notifications`);
  await page.getByRole("heading", { name: "Notifications" }).waitFor();
  return { user, page };
}

const prefRow = async (s: Stack, userId: string) => (await s.admin.from("notification_preferences").select("client_completed, approval_received, referral_received").eq("user_id", userId).maybeSingle()).data;

describe("notification settings without push configured", () => {
  it("still saves per-event choices, and says push is not set up on this server", async () => {
    stack = await startStack();
    const { user, page } = await openSettings(stack, "nt-off");
    await page.getByText("Notifications are not set up on this server yet.").waitFor();
    expect(await page.getByRole("button", { name: /Turn on for this device/ }).count()).toBe(0);
    expect(await prefRow(stack, user.id), "everything starts off").toBeNull();

    await page.getByLabel("A client finished their interview").check();
    await page.getByLabel("A client suggested someone").check();
    await page.waitForTimeout(1000);
    expect(await prefRow(stack, user.id)).toEqual({ client_completed: true, approval_received: false, referral_received: true });

    await page.reload();
    expect(await page.getByLabel("A client finished their interview").isChecked()).toBe(true);
    expect(await page.getByLabel("A client approved a case study").isChecked()).toBe(false);
    await page.getByLabel("A client finished their interview").uncheck();
    await page.waitForTimeout(1000);
    expect((await prefRow(stack, user.id))?.client_completed).toBe(false);
  }, 120_000);
});

describe("notification settings with push configured", () => {
  it("offers the device button only, and asks the browser for permission only after a click", async () => {
    await stopStack(stack);
    stack = await startStack({ VAPID_PUBLIC_KEY: webpush.generateVAPIDKeys().publicKey, VAPID_PRIVATE_KEY: webpush.generateVAPIDKeys().privateKey, VAPID_SUBJECT: "mailto:ops@example.com" });
    const { page } = await openSettings(stack, "nt-on", { grant: true });
    await page.getByRole("button", { name: "Turn on for this device" }).waitFor();
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => (window as unknown as { __permissionAsks: number }).__permissionAsks), "the page asked for permission on its own").toBe(0);
    // A browser where the user has blocked notifications gets a clear explanation, not a button that cannot work.
    const blocked = await openSettings(stack, "nt-blocked");
    await blocked.page.getByText(/Notifications are blocked for this site/).waitFor();
    // Explains what is (not) sent.
    await page.getByText(/never include names or answers/).waitFor();
  }, 120_000);
});

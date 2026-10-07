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

async function dashboardFor(user: { email: string; password: string }) {
  const page = await newPage(stack);
  await signIn(page, user.email, user.password);
  await page.waitForURL(`${BASE}/app/dashboard`);
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  return page;
}

async function addRequests(userId: string, count: number, status = "sent", ageDays = 0) {
  const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", userId).single();
  for (let i = 0; i < count; i++) {
    await stack.admin.from("proof_requests").insert({ workspace_id: member?.workspace_id, client_name: "Dana", client_email: "d@example.test", flow_type: "agency", token_hash: randomBytes(32).toString("hex"), expires_at: new Date(Date.now() + 86_400_000).toISOString(), status, created_at: new Date(Date.now() - ageDays * 86_400_000).toISOString() });
  }
  return String(member?.workspace_id);
}

describe("dashboard", () => {
  it("shows an empty state and a first step to a brand new workspace", async () => {
    const user = await createUser(stack.admin, "dash-new");
    const page = await dashboardFor(user);
    await page.getByText(/No numbers yet/).waitFor();
    expect(await page.getByTestId("next-title").textContent()).toBe("Send your first proof request");
    await page.getByRole("link", { name: "New request" }).first().waitFor();
    // The chart has a text alternative.
    expect(await page.getByRole("img", { name: /Page views per day.*0 in total/ }).count()).toBe(1);
  }, 120_000);

  it("shows a user their own numbers and nobody else's", async () => {
    const a = await createUser(stack.admin, "dash-a");
    const b = await createUser(stack.admin, "dash-b");
    await addRequests(a.id, 3, "sent", 5);
    await addRequests(b.id, 1, "sent", 0);

    const pageA = await dashboardFor(a);
    expect(await pageA.getByTestId("next-title").textContent()).toBe("3 clients have not responded yet");
    await pageA.getByText("Proof requests").first().waitFor();
    // The numbers count up for about 0.6 s, so wait for them to settle.
    const funnelOf = (page: typeof pageA) => page.locator("section[aria-labelledby=funnel-heading]").innerText();
    await expect.poll(() => funnelOf(pageA), { timeout: 5000 }).toMatch(/Sent\s*3/);

    const pageB = await dashboardFor(b);
    await expect.poll(() => funnelOf(pageB), { timeout: 5000 }).toMatch(/Sent\s*1/);
    expect(await funnelOf(pageB)).not.toMatch(/Sent\s*3/);
    expect(await pageB.getByTestId("next-title").textContent()).toBe("Your requests are out");
  }, 120_000);
});

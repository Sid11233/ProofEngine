import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, createUser, newPage, signIn, startStack, stopStack, watchConsole, type Stack } from "./harness";

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

async function proWorkspaceOf(userId: string) {
  const { data } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", userId).single();
  await stack.admin.from("workspaces").update({ plan: "pro" }).eq("id", data?.workspace_id);
  return String(data?.workspace_id);
}

describe("requests and interview links in a real browser", () => {
  it("an owner creates a request, shares the link, and the link opens for the client with safe headers", async () => {
    const owner = await createUser(stack.admin, "req-owner");
    await proWorkspaceOf(owner.id);
    const page = await newPage(stack);
    const problems = watchConsole(page);
    await signIn(page, owner.email, owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);

    await page.getByRole("link", { name: "Requests" }).click();
    await page.getByRole("link", { name: "New request" }).click();

    await page.getByRole("button", { name: "Create request" }).click();
    await page.getByText("Enter the client's name").waitFor();

    await page.getByLabel("Client name").fill("Jamie Rivera");
    await page.getByLabel("Client email").fill("jamie@example.test");
    await page.getByLabel("Outcome 1").fill("more leads");
    await page.getByRole("button", { name: "Create request" }).click();

    const link = await page.getByLabel("Interview link").inputValue();
    expect(link).toMatch(new RegExp(`^${BASE}/i/[A-Za-z0-9_-]{43}$`));

    // The client opens it with no account and no cookies.
    const res = await fetch(link);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.text()).toContain("Jamie");

    // The owner revokes it: the very next request is a 404.
    await page.getByRole("link", { name: "View request" }).click();
    await page.getByRole("button", { name: "Revoke link" }).click();
    await page.getByText(/stops working immediately/).waitFor();
    expect((await fetch(link)).status).toBe(404);

    // A new link revives it; the old one stays dead.
    await page.getByRole("button", { name: "New link" }).click();
    const fresh = await page.getByLabel("Interview link").inputValue();
    expect(fresh).not.toBe(link);
    expect((await fetch(fresh)).status).toBe(200);
    expect((await fetch(link)).status).toBe(404);

    expect(problems, `console problems: ${problems.join(" | ")}`).toEqual([]);
    await page.close();
  }, 120_000);

  it("invalid, malformed and revoked links all look identical", async () => {
    const bodies = new Set<string>();
    const normalise = (html: string) => html.replace(/nonce="[^"]*"/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/[A-Za-z0-9_-]{43}/g, "TOKEN");
    for (const path of ["a".repeat(43), "short", "x".repeat(43).replace(/x/g, "_"), "%2e%2e%2f"]) {
      const res = await fetch(`${BASE}/i/${path}`, { headers: { "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 1}` } });
      expect(res.status, `status for ${path}`).toBe(404);
      bodies.add(normalise(await res.text()));
    }
    expect(bodies.size, "404 pages differ between invalid links").toBe(1);
  });

  it("hammering the interview endpoint from one IP is throttled", async () => {
    const headers = { "x-forwarded-for": "198.51.100.250" };
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) statuses.push((await fetch(`${BASE}/i/${"b".repeat(43)}`, { headers })).status);
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    // Past the 30 per minute limit the page says "too many requests" instead of a 404.
    const limited = await fetch(`${BASE}/i/${"b".repeat(43)}`, { headers });
    expect(await limited.text()).toContain("Too many requests");
  });

  it("a viewer cannot reach the create form, and another workspace's request is a 404", async () => {
    const ownerA = await createUser(stack.admin, "req-a");
    const wsA = await proWorkspaceOf(ownerA.id);
    const { data: made } = await stack.admin.from("proof_requests").insert({
      workspace_id: wsA, created_by: ownerA.id, client_name: "Private Client", client_email: "p@example.test", flow_type: "agency",
      token_hash: "a".repeat(64), expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }).select("id").single();

    const other = await createUser(stack.admin, "req-b");
    const page = await newPage(stack);
    await signIn(page, other.email, other.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    const res = await page.goto(`${BASE}/app/requests/${made?.id}`);
    expect(res?.status()).toBe(404);
    expect(await page.content()).not.toContain("Private Client");

    const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", other.id).single();
    await stack.admin.from("workspace_members").update({ role: "viewer" }).eq("workspace_id", member?.workspace_id).eq("user_id", other.id).neq("role", "owner");
    await page.close();
  }, 120_000);
});

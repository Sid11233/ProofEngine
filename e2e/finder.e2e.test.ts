import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, createUser, newPage, signIn, startStack, stopStack, type Stack } from "./harness";

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

async function open(email: string, password: string) {
  const page = await newPage(stack);
  await signIn(page, email, password);
  await page.waitForURL(`${BASE}/app/dashboard`);
  await page.goto(`${BASE}/app/finder`);
  await page.getByRole("heading", { name: "Find communities" }).waitFor();
  return page;
}

async function ownerOf(label: string, niche: string) {
  const user = await createUser(stack.admin, label);
  const { data: m } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", user.id).single();
  await stack.admin.from("workspaces").update({ niche, audience: "Founders" }).eq("id", m?.workspace_id);
  return { ...user, ws: String(m?.workspace_id) };
}

describe("community finder", () => {
  it("warns about the rules, ranks by niche, opens links safely, filters, and shows notes as text", async () => {
    const owner = await ownerOf("fd-owner", "SaaS startup");
    const page = await open(owner.email, owner.password);

    await page.getByText("Read the rules before you post.").waitFor();
    expect(await page.getByText("Read this community’s rules before you post anything.").count()).toBeGreaterThanOrEqual(40);

    const cards = page.getByTestId("community");
    expect(await cards.count()).toBeGreaterThanOrEqual(40);
    // For a SaaS workspace, SaaS communities rank above design ones (placeholder names carry their niche).
    const names = (await cards.allTextContents()).map((t) => t.split("Needs verification")[0]);
    const firstSaas = names.findIndex((n) => n.includes("SaaS founders"));
    const firstDesign = names.findIndex((n) => n.includes("Designers"));
    expect(firstSaas).toBeGreaterThanOrEqual(0);
    expect(firstSaas, "a design community outranked every SaaS one").toBeLessThan(firstDesign);
    expect(firstSaas).toBeLessThan(10);
    expect(await page.getByText("Needs verification").count()).toBeGreaterThanOrEqual(40);

    // Every outbound link is https, opens in a new tab and cannot reach back to this page.
    const links = await page.locator('[data-testid=community] a[href]').evaluateAll((els) => els.map((a) => ({ href: (a as HTMLAnchorElement).href, target: (a as HTMLAnchorElement).target, rel: (a as HTMLAnchorElement).rel })));
    expect(links.length).toBeGreaterThanOrEqual(40);
    for (const l of links) {
      expect(l.href.startsWith("https://"), l.href).toBe(true);
      expect(l.target).toBe("_blank");
      expect(l.rel.split(" ").sort()).toEqual(["noopener", "noreferrer"]);
    }

    // Filter by platform.
    await page.getByLabel("Platform").selectOption("reddit");
    const reddit = await cards.count();
    expect(reddit).toBeGreaterThan(0);
    expect(reddit).toBeLessThan(40);
    for (const text of await cards.allTextContents()) expect(text.toLowerCase()).toContain("reddit");
    await page.getByLabel("Platform").selectOption("all");

    // Track one with a markup-looking note: it is stored and shown as plain text.
    const first = cards.first();
    await first.getByLabel("Your status").selectOption("joined");
    await first.getByLabel(/Notes/).fill("Joined <b>today</b> & read <script>alert(1)</script> the rules");
    await first.getByRole("button", { name: "Save" }).click();
    await first.locator("[role=status]").filter({ hasText: "Saved." }).waitFor();
    const { data } = await stack.admin.from("workspace_communities").select("status, notes").eq("workspace_id", owner.ws);
    expect(data).toEqual([{ status: "joined", notes: "Joined <b>today</b> & read <script>alert(1)</script> the rules" }]);

    await page.reload();
    const again = page.getByTestId("community").first();
    expect(await again.getByLabel(/Notes/).inputValue()).toBe("Joined <b>today</b> & read <script>alert(1)</script> the rules");
    expect(await page.locator("[data-testid=community] b, [data-testid=community] script").count(), "a note became markup").toBe(0);
    await page.getByLabel("Only the ones I track").check();
    expect(await page.getByTestId("community").count()).toBe(1);

    // Stop tracking. (Leave the "only mine" filter first: the card legitimately leaves that list once removed.)
    await page.getByLabel("Only the ones I track").uncheck();
    const target = page.getByTestId("community").first();
    await target.getByLabel("Your status").selectOption("none");
    await target.getByRole("button", { name: "Save" }).click();
    for (let i = 0; i < 40; i++) {
      if (((await stack.admin.from("workspace_communities").select("community_id").eq("workspace_id", owner.ws)).data ?? []).length === 0) break;
      await page.waitForTimeout(250);
    }
    expect((await stack.admin.from("workspace_communities").select("community_id").eq("workspace_id", owner.ws)).data).toHaveLength(0);
  }, 180_000);

  it("shows viewers the list without tracking, and never shows one workspace's notes to another", async () => {
    const a = await ownerOf("fd-a", "Design agency");
    const b = await ownerOf("fd-b", "Design agency");
    await stack.admin.from("workspace_communities").insert({ workspace_id: a.ws, community_id: "b0000000-0000-4000-8000-000000000011", status: "posted", notes: "A SECRET NOTE" });

    const viewer = await createUser(stack.admin, "fd-viewer", { withWorkspace: false });
    await stack.admin.from("workspace_members").insert({ workspace_id: a.ws, user_id: viewer.id, role: "viewer" });
    const vPage = await open(viewer.email, viewer.password);
    expect(await vPage.getByTestId("community").count()).toBeGreaterThanOrEqual(40);
    expect(await vPage.getByLabel("Your status").count(), "a viewer was offered tracking").toBe(0);
    expect(await vPage.locator("body").innerText()).not.toContain("A SECRET NOTE");

    const bPage = await open(b.email, b.password);
    expect(await bPage.locator("body").innerText()).not.toContain("A SECRET NOTE");
    expect(await bPage.getByLabel("Only the ones I track").count()).toBe(1);
    await bPage.getByLabel("Only the ones I track").check();
    expect(await bPage.getByTestId("community").count()).toBe(0);
  }, 180_000);
});

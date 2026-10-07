import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, createUser, newPage, signIn, startStack, stopStack, type Stack } from "./harness";
import { loadLocalConfig, makeClient } from "../supabase/tests/isolation/harness";

let stack: Stack;
let platform: Awaited<ReturnType<typeof createUser>>;
// Five communities are marked verified for the tests that need something visible to a normal user; they are put back afterwards.
let verified: string[] = [];

beforeAll(async () => {
  platform = await createUser(makeClient(loadLocalConfig(), "service"), "fd-platform");
  stack = await startStack({ PLATFORM_ADMIN_EMAILS: platform.email });
  const { data } = await stack.admin.from("communities").select("id").eq("needs_verification", true).order("name").limit(5);
  verified = (data ?? []).map((c) => String(c.id));
  await stack.admin.from("communities").update({ needs_verification: false, last_verified_at: new Date().toISOString() }).in("id", verified);
}, 120_000);

afterAll(async () => {
  await stack.admin.from("communities").update({ needs_verification: true, last_verified_at: null }).in("id", verified);
  await stopStack(stack);
});

async function open(email: string, password: string) {
  const page = await newPage(stack);
  await signIn(page, email, password);
  await page.waitForURL(/\/app\/dashboard|\/onboarding/);
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
  it("shows a normal user only verified communities, with the rules warning, safe links, filters and notes as text", async () => {
    const owner = await ownerOf("fd-owner", "SaaS startup");
    const page = await open(owner.email, owner.password);

    await page.getByText("Read the rules before you post.").waitFor();
    const cards = page.getByTestId("community");
    expect(await cards.count()).toBe(5);
    expect(await page.getByText("Needs verification").count(), "an unverified community was shown to a normal user").toBe(0);

    // Every outbound link is https, opens in a new tab and cannot reach back to this page.
    const links = await page.locator("[data-testid=community] a[href]").evaluateAll((els) => els.map((a) => ({ href: (a as HTMLAnchorElement).href, target: (a as HTMLAnchorElement).target, rel: (a as HTMLAnchorElement).rel })));
    expect(links).toHaveLength(5);
    for (const l of links) {
      expect(l.href.startsWith("https://"), l.href).toBe(true);
      expect(l.target).toBe("_blank");
      expect(l.rel.split(" ").sort()).toEqual(["noopener", "noreferrer"]);
    }

    // The rules row is closed until opened.
    const first = cards.first();
    const rules = first.getByRole("button", { name: "Rules and self-promotion" });
    expect(await rules.getAttribute("aria-expanded")).toBe("false");
    await rules.click();
    expect(await rules.getAttribute("aria-expanded")).toBe("true");

    // Track one with a markup-looking note: it saves by itself and is shown as plain text.
    await first.getByRole("radio", { name: "Joined" }).click();
    await first.locator("[role=status]").filter({ hasText: "Saved" }).waitFor();
    await first.getByLabel("Notes").fill("Joined <b>today</b> & read <script>alert(1)</script> the rules");
    await first.getByLabel("Notes").blur();
    for (let i = 0; i < 40; i++) {
      const { data } = await stack.admin.from("workspace_communities").select("status, notes").eq("workspace_id", owner.ws);
      if (data?.[0]?.notes) break;
      await page.waitForTimeout(250);
    }
    const { data } = await stack.admin.from("workspace_communities").select("status, notes").eq("workspace_id", owner.ws);
    expect(data).toEqual([{ status: "joined", notes: "Joined <b>today</b> & read <script>alert(1)</script> the rules" }]);

    await page.reload();
    expect(await page.getByTestId("community").first().getByLabel("Notes").inputValue()).toBe("Joined <b>today</b> & read <script>alert(1)</script> the rules");
    expect(await page.locator("[data-testid=community] b, [data-testid=community] script").count(), "a note became markup").toBe(0);

    // "Tracked only" shows just that one; stopping tracking empties it and shows the empty picture.
    await page.getByRole("button", { name: "Tracked only" }).click();
    expect(await page.getByTestId("community").count()).toBe(1);
    await page.getByTestId("community").first().getByRole("radio", { name: "Not tracking" }).click();
    await page.getByText("You are not tracking any communities yet").waitFor();
    expect(await page.locator('[data-illustration="FD-2"]').count()).toBe(1);
    for (let i = 0; i < 40; i++) {
      if (((await stack.admin.from("workspace_communities").select("community_id").eq("workspace_id", owner.ws)).data ?? []).length === 0) break;
      await page.waitForTimeout(250);
    }
    expect((await stack.admin.from("workspace_communities").select("community_id").eq("workspace_id", owner.ws)).data).toHaveLength(0);
  }, 180_000);

  it("shows platform operators every community, including unverified ones, and lets them filter by platform", async () => {
    const page = await open(platform.email, platform.password);
    const cards = page.getByTestId("community");
    expect(await cards.count()).toBeGreaterThanOrEqual(40);
    expect(await page.getByText("Needs verification").count()).toBeGreaterThanOrEqual(30);
    await page.getByRole("button", { name: "Reddit" }).click();
    const reddit = await cards.count();
    expect(reddit).toBeGreaterThan(0);
    expect(reddit).toBeLessThan(40);
    for (const text of await cards.allTextContents()) expect(text.toLowerCase()).toContain("reddit");
  }, 180_000);

  it("shows a workspace with nothing verified an explanation instead of a list", async () => {
    await stack.admin.from("communities").update({ needs_verification: true }).in("id", verified);
    try {
      const owner = await ownerOf("fd-empty", "Design agency");
      const page = await open(owner.email, owner.password);
      await page.getByText("No communities to show yet").waitFor();
      expect(await page.getByTestId("community").count()).toBe(0);
      expect(await page.locator('[data-illustration="FD-1"]').count()).toBeGreaterThan(0);
    } finally {
      await stack.admin.from("communities").update({ needs_verification: false, last_verified_at: new Date().toISOString() }).in("id", verified);
    }
  }, 180_000);

  it("shows viewers the list without tracking, and never shows one workspace's notes to another", async () => {
    const a = await ownerOf("fd-a", "Design agency");
    const b = await ownerOf("fd-b", "Design agency");
    await stack.admin.from("workspace_communities").insert({ workspace_id: a.ws, community_id: verified[0], status: "posted", notes: "A SECRET NOTE" });

    const viewer = await createUser(stack.admin, "fd-viewer", { withWorkspace: false });
    await stack.admin.from("workspace_members").insert({ workspace_id: a.ws, user_id: viewer.id, role: "viewer" });
    const vPage = await open(viewer.email, viewer.password);
    expect(await vPage.getByTestId("community").count()).toBe(5);
    expect(await vPage.getByRole("radiogroup").count(), "a viewer was offered tracking").toBe(0);
    expect(await vPage.locator("body").innerText()).not.toContain("A SECRET NOTE");

    const bPage = await open(b.email, b.password);
    expect(await bPage.locator("body").innerText()).not.toContain("A SECRET NOTE");
    await bPage.getByRole("button", { name: "Tracked only" }).click();
    await bPage.getByText("You are not tracking any communities yet").waitFor();
    expect(await bPage.getByTestId("community").count()).toBe(0);
  }, 180_000);
});

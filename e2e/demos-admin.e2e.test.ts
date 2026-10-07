import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { loadLocalConfig, makeClient } from "../supabase/tests/isolation/harness";
import { BASE, PORT, createUser, newPage, signIn, startStack, stopStack, type Stack } from "./harness";

let stack: Stack;
let platform: { id: string; email: string; password: string };

beforeAll(async () => {
  platform = await createUser(makeClient(loadLocalConfig(), "service"), "da-platform");
  stack = await startStack({ PUBLIC_SITES_DOMAIN: `localhost:${PORT}`, PLATFORM_ADMIN_EMAILS: platform.email });
}, 120_000);
afterAll(async () => {
  await stopStack(stack);
});

const site = (workspace: string, path = "/") => `http://${workspace}.localhost:${PORT}${path}`;

async function liveDemo(label: string, slug = "tour") {
  const owner = await createUser(stack.admin, label);
  const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", owner.id).single();
  const ws = String(member?.workspace_id);
  const workspace = `da-${randomBytes(4).toString("hex")}`;
  await stack.admin.from("workspaces").update({ plan: "pro", subdomain_slug: workspace, name: "Acme Studio" }).eq("id", ws);
  const content = { scenes: [{ id: "c1", type: "chat", persona: { name: "Ava", role: "Agent" }, messages: [{ from: "agent", text: "Hello", delayMs: 0 }], choices: [] }, { id: "c2", type: "chat", persona: { name: "Ava", role: "Agent" }, messages: [{ from: "agent", text: "Bye", delayMs: 0 }], choices: [] }] };
  const { data: demo } = await stack.admin.from("demos").insert({ workspace_id: ws, created_by: owner.id, title: "Product tour", content, authenticity_attested: true, redaction_acknowledged: true }).select("id").single();
  const id = String(demo?.id);
  const res = await stack.admin.from("demos").update({ status: "published", slug }).eq("id", id);
  if (res.error) throw new Error(res.error.message);
  return { owner, ws, workspace, id, slug };
}

describe("demo reports and blocking", () => {
  it("a visitor reports a demo; a platform admin reads it as text, blocks it, and the workspace cannot bring it back", async () => {
    const d = await liveDemo("da-flow");
    const visitor = await newPage(stack);
    await visitor.goto(site(d.workspace, `/demo/${d.slug}/report`));
    await visitor.getByLabel("What is wrong with this page?").fill("It shows <b>my</b> company name without asking.");
    await visitor.getByLabel(/Your email/).fill("reporter@example.com");
    await visitor.getByRole("button", { name: "Send report" }).click();
    await visitor.getByText(/Thank you/).waitFor();
    expect((await stack.admin.from("demo_reports").select("status").eq("demo_id", d.id)).data).toEqual([{ status: "open" }]);
    expect((await visitor.goto(site(d.workspace, `/demo/${d.slug}`)))?.status()).toBe(200);

    const adminPage = await newPage(stack);
    await signIn(adminPage, platform.email, platform.password);
    await adminPage.waitForURL(`${BASE}/app/dashboard`);
    await adminPage.getByRole("link", { name: "Demo reports" }).click();
    const reason = adminPage.getByTestId("report-reason").first();
    await reason.waitFor();
    expect(await reason.textContent()).toBe("It shows <b>my</b> company name without asking.");
    expect(await reason.locator("b").count()).toBe(0);

    await adminPage.getByRole("button", { name: "Block demo now" }).first().click();
    await adminPage.getByText(/Demo blocked/).waitFor();
    expect((await visitor.goto(site(d.workspace, `/demo/${d.slug}`)))?.status()).toBe(404);
    expect((await stack.admin.from("demos").select("status").eq("id", d.id).single()).data?.status).toBe("blocked");
    const back = await stack.admin.from("demos").update({ status: "published" }).eq("id", d.id);
    expect(back.error?.message).toContain("publish_blocked");

    await adminPage.getByRole("button", { name: "Unblock demo" }).first().click();
    await adminPage.getByText(/Demo unblocked/).waitFor();
    expect((await stack.admin.from("demos").select("status").eq("id", d.id).single()).data?.status).toBe("unpublished");
  }, 180_000);

  it("the review page does not exist for anyone else", async () => {
    const owner = await createUser(stack.admin, "da-regular");
    const page = await newPage(stack);
    await signIn(page, owner.email, owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    expect(await page.getByRole("link", { name: "Demo reports" }).count()).toBe(0);
    expect((await page.goto(`${BASE}/app/admin/demo-reports`))?.status()).toBe(404);
  }, 120_000);
});

describe("results and leads", () => {
  it("shows counts and leads to the workspace only, lets an owner delete a lead", async () => {
    const d = await liveDemo("da-results", "results-demo");
    const other = await createUser(stack.admin, "da-results-other");
    await stack.admin.from("demo_events").insert([
      ...Array.from({ length: 5 }, () => ({ workspace_id: d.ws, demo_id: d.id, type: "view" })),
      { workspace_id: d.ws, demo_id: d.id, type: "step", step_index: 1 }, { workspace_id: d.ws, demo_id: d.id, type: "step", step_index: 1 },
      { workspace_id: d.ws, demo_id: d.id, type: "complete" }, { workspace_id: d.ws, demo_id: d.id, type: "cta_click" },
    ]);
    await stack.admin.from("demo_leads").insert({ workspace_id: d.ws, demo_id: d.id, email: "lead<b>@example.test", name: "Lee <i>X</i>", consent: true, consent_text_version: "demo-lead-v1", step_reached: 1 });

    const page = await newPage(stack);
    await signIn(page, d.owner.email, d.owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.goto(`${BASE}/app/demos/${d.id}/results`);
    await page.getByText("Where people get to").waitFor();
    expect(await page.getByText("Views", { exact: true }).locator("xpath=preceding-sibling::p").textContent()).toBe("5");
    expect(await page.getByText("Step 2").locator("xpath=following-sibling::span[2]").textContent()).toBe("2");
    await page.getByText("lead<b>@example.test").waitFor(); // shown literally
    expect(await page.locator("td b, td i").count()).toBe(0);

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: /Delete lead/ }).click();
    await page.getByText("No leads yet.").waitFor();
    expect((await stack.admin.from("demo_leads").select("id").eq("demo_id", d.id)).data).toHaveLength(0);

    const outsider = await newPage(stack);
    await signIn(outsider, other.email, other.password);
    await outsider.waitForURL(`${BASE}/app/dashboard`);
    expect((await outsider.goto(`${BASE}/app/demos/${d.id}/results`))?.status()).toBe(404);
  }, 180_000);
});

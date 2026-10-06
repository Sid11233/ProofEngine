import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { loadLocalConfig, makeClient } from "../supabase/tests/isolation/harness";
import { BASE, PORT, createUser, newPage, signIn, startStack, stopStack, type Stack, signStudy } from "./harness";

let stack: Stack;
let platform: { id: string; email: string; password: string };

beforeAll(async () => {
  platform = await createUser(makeClient(loadLocalConfig(), "service"), "td-platform");
  stack = await startStack({ PUBLIC_SITES_DOMAIN: `localhost:${PORT}`, PLATFORM_ADMIN_EMAILS: platform.email });
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

const site = (workspace: string, path = "/") => `http://${workspace}.localhost:${PORT}${path}`;

async function publishedStudy(label: string) {
  const owner = await createUser(stack.admin, label);
  const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", owner.id).single();
  const ws = String(member?.workspace_id);
  const workspace = `e2e-${randomBytes(4).toString("hex")}`;
  await stack.admin.from("workspaces").update({ plan: "pro", subdomain_slug: workspace, name: "Acme Studio" }).eq("id", ws);
  const content = { headline: "Reported headline", client: { name: "Dana" }, sections: [{ type: "challenge", title: "The challenge", body: "Slow." }], tags: [] };
  const { data: study } = await stack.admin.from("case_studies").insert({ workspace_id: ws, content, status: "draft" }).select("id").single();
  await stack.admin.from("case_study_versions").insert({ case_study_id: study?.id, workspace_id: ws, version: 1, content });
  await stack.admin.from("approvals").insert({ case_study_id: study?.id, workspace_id: ws, version: 1, approver_email: "d@example.test", method: "email_link" });
  await signStudy(stack.admin, String(study?.id));
  const res = await stack.admin.from("case_studies").update({ status: "published", slug: "reported-story" }).eq("id", study?.id);
  if (res.error) throw new Error(res.error.message);
  return { owner, ws, workspace, id: String(study?.id) };
}

async function submitReport(page: Awaited<ReturnType<typeof newPage>>, s: { workspace: string }, email: string, reason: string) {
  await page.goto(site(s.workspace, "/reported-story"));
  await page.getByRole("link", { name: "Report this page" }).click();
  await page.getByLabel("What is wrong with this page?").fill(reason);
  await page.getByLabel(/Your email/).fill(email);
  await page.getByRole("button", { name: "Send report" }).click();
}

describe("report and takedown", () => {
  it("a visitor reports a page; a platform admin reviews it as text and disables it", async () => {
    const s = await publishedStudy("td-flow");
    const visitor = await newPage(stack);
    await submitReport(visitor, s, "visitor@example.com", "I am in this story <b>and</b> did not agree.");
    await visitor.getByText(/Thank you. We have passed your report/).waitFor();

    const { data: rows } = await stack.admin.from("takedown_requests").select("reason, contact_email, status, ip_hash").eq("case_study_id", s.id);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({ contact_email: "visitor@example.com", status: "open" });
    expect(rows?.[0].ip_hash).toMatch(/^[0-9a-f]{64}$/);
    // The report alone does not remove anything.
    expect((await visitor.goto(site(s.workspace, "/reported-story")))?.status()).toBe(200);

    const adminPage = await newPage(stack);
    await signIn(adminPage, platform.email, platform.password);
    await adminPage.waitForURL(`${BASE}/app/dashboard`);
    await adminPage.getByRole("link", { name: "Takedowns" }).click();
    const reason = adminPage.getByTestId("report-reason").first();
    await reason.waitFor();
    expect(await reason.textContent()).toBe("I am in this story <b>and</b> did not agree.");
    expect(await reason.locator("b").count(), "report text was rendered as markup").toBe(0);

    await adminPage.getByRole("button", { name: "Disable page now" }).first().click();
    await adminPage.getByText(/Page disabled/).waitFor();
    expect((await visitor.goto(site(s.workspace, "/reported-story")))?.status(), "disabled page still public").toBe(404);
    expect((await visitor.goto(site(s.workspace, "/reported-story/report")))?.status()).toBe(404);

    // The workspace cannot republish it.
    const res = await stack.admin.from("case_studies").update({ status: "published" }).eq("id", s.id);
    expect(res.error?.message).toContain("publish_blocked");
  }, 180_000);

  it("the review page does not exist for anyone else", async () => {
    const owner = await createUser(stack.admin, "td-regular");
    const page = await newPage(stack);
    await signIn(page, owner.email, owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    expect(await page.getByRole("link", { name: "Takedowns" }).count()).toBe(0);
    expect((await page.goto(`${BASE}/app/admin/takedowns`))?.status()).toBe(404);
    const anonymous = await newPage(stack);
    await anonymous.goto(`${BASE}/app/admin/takedowns`);
    expect(anonymous.url()).toContain("/login");
  }, 120_000);

  it("rate limits reports from one address, and rejects bad input without storing it", async () => {
    const s = await publishedStudy("td-limit");
    const visitor = await newPage(stack);
    await visitor.goto(site(s.workspace, "/reported-story/report"));
    await visitor.getByLabel("What is wrong with this page?").fill("too short");
    await visitor.getByLabel(/Your email/).fill("bad@example.com");
    await visitor.getByRole("button", { name: "Send report" }).click();
    await visitor.getByRole("alert").waitFor();
    expect((await stack.admin.from("takedown_requests").select("id").eq("case_study_id", s.id)).data).toHaveLength(0);

    for (let i = 1; i <= 5; i++) {
      await submitReport(visitor, s, `v${i}@example.com`, `This is report number ${i} about the page.`);
      await visitor.getByText(/Thank you/).waitFor();
    }
    await submitReport(visitor, s, "v6@example.com", "This is report number 6 about the page.");
    await visitor.getByText(/Too many reports/).waitFor();
    expect((await stack.admin.from("takedown_requests").select("id").eq("case_study_id", s.id)).data).toHaveLength(5);
  }, 180_000);
});

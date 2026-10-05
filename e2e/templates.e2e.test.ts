import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, createUser, newPage, signIn, startStack, stopStack, watchConsole, type Stack } from "./harness";

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

const content = {
  headline: "Faster onboarding for Acme",
  client: { name: "Dana" },
  sections: [
    { type: "challenge", title: "The challenge", body: "Onboarding was slow." },
    { type: "results", title: "Results", metrics: [] },
  ],
  tags: ["onboarding"],
};

async function seed(userId: string, plan: "free" | "pro") {
  const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", userId).single();
  const ws = String(member?.workspace_id);
  await stack.admin.from("workspaces").update({ plan }).eq("id", ws);
  const { data: study } = await stack.admin.from("case_studies").insert({ workspace_id: ws, content, status: "draft" }).select("id").single();
  await stack.admin.from("case_study_versions").insert({ case_study_id: study?.id, workspace_id: ws, version: 1, content });
  return { ws, studyId: String(study?.id) };
}

describe("the template gallery", () => {
  it("shows five templates with lock badges by plan, filters by category, and switching never touches the content", async () => {
    const owner = await createUser(stack.admin, "tpl-owner");
    const s = await seed(owner.id, "free");
    const page = await newPage(stack);
    const problems = watchConsole(page);
    await signIn(page, owner.email, owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);

    await page.goto(`${BASE}/app/case-studies/${s.studyId}/template`);
    await page.getByRole("heading", { name: "Choose a template" }).waitFor();
    expect(await page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) }).count()).toBe(5);

    // Free workspace: 2 free templates open, 3 pro templates locked.
    expect(await page.getByText(/^Locked: Pro$/).count()).toBe(3);
    expect(await page.getByText(/^Free$/).count()).toBe(2);
    await page.getByText("Classic").first().waitFor();
    // The thumbnails use the owner's own content (rendered, hidden from assistive technology).
    expect(await page.locator("[aria-hidden=true] h1", { hasText: "Faster onboarding for Acme" }).count()).toBe(5);

    // Category filter.
    await page.getByRole("button", { name: "story" }).click();
    expect(await page.getByRole("heading", { level: 2 }).count()).toBe(2);
    await page.getByRole("button", { name: "all" }).click();
    expect(await page.getByRole("heading", { level: 2 }).count()).toBe(5);

    const before = (await stack.admin.from("case_studies").select("content, current_version, status").eq("id", s.studyId).single()).data;

    // Pick a free template, then a locked one (allowed for preview).
    const minimal = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Minimal" }) });
    await minimal.getByRole("button", { name: "Use this template" }).click();
    await page.getByText("Now using Minimal.").waitFor();
    await minimal.getByRole("button", { name: "Selected" }).waitFor();

    const locked = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Timeline Story" }) });
    await locked.getByText(/preview this with a watermark/i).waitFor();
    await locked.getByRole("button", { name: "Preview this template" }).click();
    await page.getByText("Now using Timeline Story.").waitFor();

    const after = (await stack.admin.from("case_studies").select("content, current_version, status, template_id, theme_settings").eq("id", s.studyId).single()).data;
    expect(after?.content, "switching templates changed the content").toEqual(before?.content);
    expect(after?.current_version).toBe(before?.current_version);
    expect(after?.status).toBe(before?.status);
    expect(after?.theme_settings).toEqual({});
    const { data: tpl } = await stack.admin.from("templates").select("name").eq("id", after?.template_id).single();
    expect(tpl?.name).toBe("Timeline Story");
    expect((await stack.admin.from("case_study_versions").select("version").eq("case_study_id", s.studyId)).data).toHaveLength(1);

    expect(problems, `console problems: ${problems.join(" | ")}`).toEqual([]);
    await page.close();
  }, 120_000);

  it("a pro workspace sees nothing locked", async () => {
    const owner = await createUser(stack.admin, "tpl-pro");
    const s = await seed(owner.id, "pro");
    const page = await newPage(stack);
    await signIn(page, owner.email, owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.goto(`${BASE}/app/case-studies/${s.studyId}/template`);
    await page.getByRole("heading", { name: "Choose a template" }).waitFor();
    expect(await page.getByText(/Locked/).count()).toBe(0);
    await page.close();
  }, 120_000);

  it("viewers can look but not choose; other workspaces get a 404", async () => {
    const owner = await createUser(stack.admin, "tpl-owner2");
    const s = await seed(owner.id, "free");
    const viewer = await createUser(stack.admin, "tpl-viewer", { withWorkspace: false });
    await stack.admin.from("workspace_members").insert({ workspace_id: s.ws, user_id: viewer.id, role: "viewer" });
    const stranger = await createUser(stack.admin, "tpl-stranger");

    const v = await newPage(stack);
    await signIn(v, viewer.email, viewer.password);
    await v.waitForURL(`${BASE}/app/dashboard`);
    await v.goto(`${BASE}/app/case-studies/${s.studyId}/template`);
    await v.getByRole("heading", { name: "Choose a template" }).waitFor();
    expect(await v.getByRole("button", { name: /Use this template|Preview this template/ }).count()).toBe(0);
    await v.close();

    const o = await newPage(stack);
    await signIn(o, stranger.email, stranger.password);
    await o.waitForURL(`${BASE}/app/dashboard`);
    expect((await o.goto(`${BASE}/app/case-studies/${s.studyId}/template`))?.status()).toBe(404);
    await o.close();
  }, 120_000);

  it("refuses to render stored content that contains markup", async () => {
    const owner = await createUser(stack.admin, "tpl-xss");
    const s = await seed(owner.id, "free");
    // Bypass the application's validation, as a bug or a manual edit might.
    await stack.admin.from("case_studies").update({ content: { ...content, headline: "<img src=x onerror=\"document.title='pwned'\">" } }).eq("id", s.studyId);
    const page = await newPage(stack);
    await signIn(page, owner.email, owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    expect((await page.goto(`${BASE}/app/case-studies/${s.studyId}/template`))?.status()).toBe(404);
    expect(await page.title()).not.toBe("pwned");
    await page.close();
  }, 120_000);
});

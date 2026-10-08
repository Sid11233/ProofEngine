import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { BASE, createUser, newPage, signIn, startStack, stopStack, watchConsole, type Stack } from "./harness";

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 120_000);
afterAll(async () => {
  await stopStack(stack);
});

async function seed(label: string) {
  const owner = await createUser(stack.admin, label);
  const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", owner.id).single();
  const ws = String(member?.workspace_id);
  await stack.admin.from("workspaces").update({ name: "Acme Studio" }).eq("id", ws);
  const { data: client } = await stack.admin.from("clients").insert({ workspace_id: ws, created_by: owner.id, name: "Roofing Co" }).select("id").single();
  const { data: project } = await stack.admin.from("projects").insert({ workspace_id: ws, client_id: client?.id, created_by: owner.id, name: "Site rebuild", summary: "We rebuilt their website.", key_facts: "Bookings went up 40% in 3 months." }).select("id").single();
  const projectId = String(project?.id);
  await stack.admin.from("project_feedback").insert({ workspace_id: ws, project_id: projectId, created_by: owner.id, source: "client", author_name: "Dana", body: "The new site is fast and our phone now rings every day." });
  await stack.admin.from("project_posts").insert([
    { workspace_id: ws, project_id: projectId, created_by: owner.id, network: "linkedin", kind: "post", body: "We rebuilt a website and bookings rose 40% in 3 months.", attested: true },
    { workspace_id: ws, project_id: projectId, created_by: owner.id, network: "linkedin", kind: "carousel", body: "A rebuild story", attested: true, slides: [
      { kind: "title", heading: "A faster website", body: "What we changed" }, { kind: "stat", heading: "40%", body: "more bookings in 3 months" },
      { kind: "quote", heading: "", body: "our phone now rings every day" }, { kind: "cta", heading: "Talk to us", body: "" },
    ] },
  ]);
  return { owner, ws, projectId };
}

describe("project posts and carousels", () => {
  it("shows a drawn carousel, rejects invented numbers on edit, exports a PDF and pictures, and hides it from other workspaces", async () => {
    const s = await seed("pp-e2e");
    const other = await createUser(stack.admin, "pp-e2e-other");
    const ctx = await stack.browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.61" } });
    const page = await ctx.newPage();
    const problems = watchConsole(page);
    await signIn(page, s.owner.email, s.owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);

    await page.goto(`${BASE}/app/projects/${s.projectId}`);
    await page.getByRole("link", { name: "Open posts and carousels" }).click();
    await page.getByRole("heading", { name: "Posts and carousels" }).waitFor();

    // generation needs the attestation, and says plainly when AI is not set up
    const write = page.getByRole("button", { name: "Write posts and carousels" });
    expect(await write.isDisabled()).toBe(true);
    await page.getByRole("checkbox", { name: /permission to share this project/ }).check();
    await write.click();
    await page.getByText("AI is not configured on this server yet.").waitFor();

    // four slides drawn on canvases in LinkedIn's size
    const canvases = page.locator("canvas");
    expect(await canvases.count()).toBe(4);
    expect(await canvases.first().evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([1080, 1350]);
    // the slide really has pixels (not blank): the dark theme background is not white
    const dark = await canvases.first().evaluate((c: HTMLCanvasElement) => Array.from(c.getContext("2d")!.getImageData(5, 5, 1, 1).data));
    expect(dark.slice(0, 3)).toEqual([28, 25, 23]);

    // editing: an invented number is refused, a true one is saved
    const caption = page.getByLabel("Caption");
    await caption.fill("Bookings rose 95% in 3 months.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByText(/not in your project/).waitFor();
    await caption.fill("Bookings rose 40% in 3 months.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByText("Saved", { exact: true }).first().waitFor();
    const { data: saved } = await stack.admin.from("project_posts").select("body").eq("project_id", s.projectId).eq("kind", "carousel").single();
    expect(saved?.body).toBe("Bookings rose 40% in 3 months.");

    // exports: a real PDF with four pages, and four PNG files
    const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PDF" }).click()]);
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
    const bytes = readFileSync((await pdf.path())!);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(4);
    expect(parsed.getPage(0).getSize()).toEqual({ width: 1080, height: 1350 });

    const names: string[] = [];
    page.on("download", (d) => names.push(d.suggestedFilename()));
    await page.getByRole("button", { name: "Download pictures" }).click();
    await page.waitForFunction(() => true);
    for (let i = 0; i < 40 && names.length < 4; i++) await page.waitForTimeout(250);
    expect(names).toEqual(["site-rebuild-linkedin-1.png", "site-rebuild-linkedin-2.png", "site-rebuild-linkedin-3.png", "site-rebuild-linkedin-4.png"]);

    // other workspaces cannot open it
    const outsider = await newPage(stack);
    await signIn(outsider, other.email, other.password);
    await outsider.waitForURL(`${BASE}/app/dashboard`);
    expect((await outsider.goto(`${BASE}/app/projects/${s.projectId}/posts`))?.status()).toBe(404);
    expect(problems.filter((p) => !/401|403|404|blob:/.test(p))).toEqual([]);
    await ctx.close();
  }, 240_000);
});

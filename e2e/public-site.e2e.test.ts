import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { BASE, PORT, createUser, newPage, startStack, stopStack, type Stack } from "./harness";

let stack: Stack;

beforeAll(async () => {
  stack = await startStack({ PUBLIC_SITES_DOMAIN: `localhost:${PORT}` });
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

const site = (workspace: string, path = "/") => `http://${workspace}.localhost:${PORT}${path}`;

/** A study published through the real trigger: approval row for the current version, then status. */
async function publishedStudy({ plan = "pro", slug = "great-result", headline = "Faster onboarding" } = {}) {
  const owner = await createUser(stack.admin, "pub");
  const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", owner.id).single();
  const ws = String(member?.workspace_id);
  const workspace = `e2e-${randomBytes(4).toString("hex")}`;
  await stack.admin.from("workspaces").update({ plan, subdomain_slug: workspace, name: "Acme Studio" }).eq("id", ws);
  const content = {
    headline,
    client: { name: "Dana" },
    sections: [
      { type: "challenge", title: "The challenge", body: "javascript:alert(document.domain) {{7*7}} onboarding was slow." },
      { type: "solution", title: "The solution", body: "We changed the process." },
    ],
    tags: [],
  };
  const { data: study } = await stack.admin.from("case_studies").insert({ workspace_id: ws, content, status: "draft" }).select("id").single();
  const id = String(study?.id);
  await stack.admin.from("case_study_versions").insert({ case_study_id: id, workspace_id: ws, version: 1, content });
  await stack.admin.from("approvals").insert({ case_study_id: id, workspace_id: ws, version: 1, approver_email: "d@example.test", method: "email_link" });
  const res = await stack.admin.from("case_studies").update({ status: "published", slug }).eq("id", id);
  if (res.error) throw new Error(res.error.message);
  return { id, workspace, slug, ws };
}

describe("public case study pages", () => {
  it("serves a published page on the workspace subdomain with strict, cookie-free responses", async () => {
    const s = await publishedStudy();
    const page = await newPage(stack);
    const response = await page.goto(site(s.workspace, `/${s.slug}`));
    expect(response?.status()).toBe(200);
    const headers = response?.headers() ?? {};
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("script-src 'self' 'nonce-");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["set-cookie"], "a public page set a cookie").toBeUndefined();
    expect(headers["cache-control"]).toContain("s-maxage=60");
    expect(headers["x-robots-tag"] ?? "").not.toContain("noindex");

    await page.getByRole("heading", { name: "Faster onboarding" }).waitFor();
    // Script-like text is shown as text and never runs.
    await page.getByText("javascript:alert(document.domain) {{7*7}}").waitFor();
    expect(await page.locator("article script, main script").count()).toBe(0);

    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe(`http://${s.workspace}.localhost:${PORT}/${s.slug}`);
    expect(await page.locator('meta[property="og:title"]').getAttribute("content")).toBe("Faster onboarding | Acme Studio");
    expect(await page.getByText("Powered by").count(), "paid plans have no badge").toBe(0);
  }, 120_000);

  it("shows Powered by on the free plan, and lists published stories on the workspace home", async () => {
    const s = await publishedStudy({ plan: "free", slug: "free-story" });
    const page = await newPage(stack);
    await page.goto(site(s.workspace, `/${s.slug}`));
    await page.getByText("Powered by").waitFor();
    await page.goto(site(s.workspace));
    await page.getByRole("link", { name: /Faster onboarding/ }).waitFor();
  }, 120_000);

  it("404s for drafts, unpublished pages, unknown pages and unknown workspaces", async () => {
    const s = await publishedStudy({ slug: "going-away" });
    const page = await newPage(stack);
    expect((await page.goto(site(s.workspace, `/${s.slug}`)))?.status()).toBe(200);

    await stack.admin.from("case_studies").update({ status: "unpublished" }).eq("id", s.id);
    expect((await page.goto(site(s.workspace, `/${s.slug}`)))?.status(), "unpublished page still served").toBe(404);
    expect((await page.goto(site(s.workspace, "/nothing-here")))?.status()).toBe(404);
    expect((await page.goto(site("no-such-workspace", "/x-y")))?.status()).toBe(404);
    expect((await page.goto(site(s.workspace)))?.status(), "workspace with nothing published").toBe(404);
  }, 120_000);

  it("keeps the app and the public sites apart", async () => {
    const s = await publishedStudy({ slug: "apart-story" });
    const page = await newPage(stack);
    // The internal route does not exist on the app host.
    expect((await page.goto(`${BASE}/sites/${s.workspace}/${s.slug}`))?.status()).toBe(404);
    // App routes do not exist on a site host: no login redirect, no app pages, no API.
    for (const path of ["/app/dashboard", "/login", "/api/case-studies/generate", "/i/abc", "/approve/abc"]) {
      const response = await page.goto(site(s.workspace, path), { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${path} reachable on a public site`).toBe(404);
    }
  }, 120_000);
});

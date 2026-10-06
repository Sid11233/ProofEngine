import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { BASE, PORT, createUser, newPage, signIn, startStack, stopStack, type Stack, signStudy } from "./harness";

let stack: Stack;

beforeAll(async () => {
  stack = await startStack({ PUBLIC_SITES_DOMAIN: `localhost:${PORT}` });
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

const site = (workspace: string, path = "/") => `http://${workspace}.localhost:${PORT}${path}`;

async function workspaceWithStory(label: string, plan = "pro") {
  const owner = await createUser(stack.admin, label);
  const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", owner.id).single();
  const ws = String(member?.workspace_id);
  const workspace = `e2e-${randomBytes(4).toString("hex")}`;
  await stack.admin.from("workspaces").update({ plan, subdomain_slug: workspace, name: "Acme Studio" }).eq("id", ws);
  const content = { headline: "Big win <b>now</b>?", client: { name: "Dana" }, sections: [{ type: "challenge", title: "The challenge", body: "Slow." }], tags: [] };
  // The headline above contains markup-like text only so the widget's escaping is exercised; the schema
  // refuses real HTML, so use a safe headline in the stored study.
  content.headline = "Big win with onboarding";
  const { data: study } = await stack.admin.from("case_studies").insert({ workspace_id: ws, content, status: "draft" }).select("id").single();
  await stack.admin.from("case_study_versions").insert({ case_study_id: study?.id, workspace_id: ws, version: 1, content });
  await stack.admin.from("approvals").insert({ case_study_id: study?.id, workspace_id: ws, version: 1, approver_email: "d@example.test", method: "email_link" });
  await signStudy(stack.admin, String(study?.id));
  const res = await stack.admin.from("case_studies").update({ status: "published", slug: "big-win" }).eq("id", study?.id);
  if (res.error) throw new Error(res.error.message);
  return { owner, ws, workspace };
}

describe("wall of proof", () => {
  it("is off by default, then served with a frame-ancestors allowlist once enabled", async () => {
    const s = await workspaceWithStory("wall-flow");
    const page = await newPage(stack);
    expect((await page.goto(site(s.workspace, "/embed")))?.status(), "widget was on by default").toBe(404);

    await stack.admin.from("wall_settings").insert({ workspace_id: s.ws, enabled: true, allowed_origins: ["https://www.example.com", "https://shop.example.org:8443"], layout: "grid", max_items: 6 });

    const response = await page.goto(site(s.workspace, "/embed"));
    expect(response?.status()).toBe(200);
    const headers = response?.headers() ?? {};
    expect(headers["content-security-policy"]).toContain("frame-ancestors https://www.example.com https://shop.example.org:8443");
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
    expect(headers["content-security-policy"]).not.toContain("script-src");
    expect(headers["x-frame-options"], "X-Frame-Options would block every embed").toBeUndefined();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["set-cookie"]).toBeUndefined();
    await page.getByRole("link", { name: /Big win with onboarding/ }).waitFor();
    expect(await page.getByRole("link", { name: /Big win/ }).getAttribute("href")).toBe(`http://${s.workspace}.localhost:${PORT}/big-win`);
    expect(await page.locator("script").count()).toBe(0);

    // Turned off again: gone.
    await stack.admin.from("wall_settings").update({ enabled: false }).eq("workspace_id", s.ws);
    expect((await page.goto(site(s.workspace, "/embed")))?.status()).toBe(404);
  }, 120_000);

  it("is not framable on the normal pages, which keep X-Frame-Options", async () => {
    const s = await workspaceWithStory("wall-frame");
    const page = await newPage(stack);
    const response = await page.goto(site(s.workspace, "/big-win"));
    expect(response?.headers()["x-frame-options"]).toBe("DENY");
    const app = await page.goto(`${BASE}/login`);
    expect(app?.headers()["x-frame-options"]).toBe("DENY");
  }, 120_000);

  it("an admin configures it from settings, and invalid sites are refused", async () => {
    const s = await workspaceWithStory("wall-settings");
    const page = await newPage(stack);
    await signIn(page, s.owner.email, s.owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.goto(`${BASE}/app/settings/wall`);

    await page.getByLabel("Allow the wall of proof to be embedded").check();
    await page.getByLabel(/Sites allowed to embed it/).fill("https://*.evil.com");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText(/is not a valid site/).waitFor();

    await page.getByLabel(/Sites allowed to embed it/).fill("https://Www.Example.com/\nhttps://example.org");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText(/Saved/).waitFor();
    const { data } = await stack.admin.from("wall_settings").select("enabled, allowed_origins").eq("workspace_id", s.ws).single();
    expect(data).toEqual({ enabled: true, allowed_origins: ["https://www.example.com", "https://example.org"] });
    const snippet = await page.getByLabel("Embed code").inputValue();
    expect(snippet).toContain(`src="http://${s.workspace}.localhost:${PORT}/embed"`);
  }, 120_000);
});

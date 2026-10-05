import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { PORT, createUser, newPage, startStack, stopStack, type Stack } from "./harness";

let stack: Stack;

beforeAll(async () => {
  stack = await startStack({ PUBLIC_SITES_DOMAIN: `localhost:${PORT}` });
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

const site = (workspace: string, path = "/") => `http://${workspace}.localhost:${PORT}${path}`;

async function publishedStudy() {
  const owner = await createUser(stack.admin, "an-e2e");
  const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", owner.id).single();
  const ws = String(member?.workspace_id);
  const workspace = `e2e-${randomBytes(4).toString("hex")}`;
  await stack.admin.from("workspaces").update({ plan: "pro", subdomain_slug: workspace, name: "Acme Studio", website: "https://example.com/hire-us" }).eq("id", ws);
  const content = { headline: "Counted story", client: { name: "Dana" }, sections: [{ type: "challenge", title: "The challenge", body: "Slow." }], tags: [] };
  const { data: study } = await stack.admin.from("case_studies").insert({ workspace_id: ws, content, status: "draft" }).select("id").single();
  await stack.admin.from("case_study_versions").insert({ case_study_id: study?.id, workspace_id: ws, version: 1, content });
  await stack.admin.from("approvals").insert({ case_study_id: study?.id, workspace_id: ws, version: 1, approver_email: "d@example.test", method: "email_link" });
  const res = await stack.admin.from("case_studies").update({ status: "published", slug: "counted-story" }).eq("id", study?.id);
  if (res.error) throw new Error(res.error.message);
  return { workspace, id: String(study?.id) };
}

const events = async (id: string) => ((await stack.admin.from("page_events").select("type, referrer").eq("case_study_id", id)).data ?? []) as Array<{ type: string; referrer: string | null }>;

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, seconds = 10): Promise<T> {
  const end = Date.now() + seconds * 1000;
  let v = await read();
  while (!done(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 300));
    v = await read();
  }
  return v;
}

describe("page analytics", () => {
  it("records a view with only the referrer hostname, once per visitor per day, and clicks", async () => {
    const s = await publishedStudy();
    const page = await newPage(stack);
    await page.route("https://example.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "ok" }));
    const cookiesBefore = (await page.context().cookies()).length;

    await page.goto(site(s.workspace, "/counted-story"), { referer: "https://News.Example.org/some/path?token=secret" });
    const first = await until(() => events(s.id), (e) => e.length >= 1);
    expect(first).toEqual([{ type: "view", referrer: "news.example.org" }]);

    await page.goto(site(s.workspace, "/counted-story"), { referer: "https://other.example.net/" });
    await page.waitForTimeout(1500);
    expect((await events(s.id)).filter((e) => e.type === "view"), "a repeat visit the same day was counted again").toHaveLength(1);

    await page.getByRole("link", { name: /Work with Acme Studio/ }).click();
    await until(() => events(s.id), (e) => e.some((x) => x.type === "cta_click"));
    await page.goto(site(s.workspace, "/counted-story"));
    await page.getByRole("link", { name: "Refer them" }).click();
    const all = await until(() => events(s.id), (e) => e.some((x) => x.type === "referral_click"));
    expect(all.map((e) => e.type).sort()).toEqual(["cta_click", "referral_click", "view"]);
    expect(all.find((e) => e.type === "cta_click")?.referrer).toBeNull();

    expect((await page.context().cookies()).length, "analytics set a cookie").toBe(cookiesBefore);
  }, 120_000);

  it("refuses cross-site, malformed and over-detailed beacons, and says nothing about unknown pages", async () => {
    const s = await publishedStudy();
    const url = site(s.workspace, "/counted-story/event");
    const post = (headers: Record<string, string>, body: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${Date.now() % 200}`, ...headers }, body });

    expect((await post({}, '{"type":"view"}')).status, "no Origin").toBe(403);
    expect((await post({ origin: "https://evil.example" }, '{"type":"view"}')).status, "foreign Origin").toBe(403);
    expect((await post({ origin: `http://${s.workspace}.localhost:${PORT}` }, "not json")).status).toBe(400);
    expect((await post({ origin: `http://${s.workspace}.localhost:${PORT}` }, '{"type":"view","ip":"1.2.3.4"}')).status, "extra field").toBe(400);
    expect((await post({ origin: `http://${s.workspace}.localhost:${PORT}` }, '{"type":"purchase"}')).status).toBe(400);
    expect((await post({ origin: `http://${s.workspace}.localhost:${PORT}` }, JSON.stringify({ type: "view", referrer: "x".repeat(5000) }))).status).toBe(413);
    expect((await events(s.id)).length).toBe(0);

    const ok = await post({ origin: `http://${s.workspace}.localhost:${PORT}`, "user-agent": "e2e-ua" }, '{"type":"view"}');
    expect(ok.status).toBe(204);
    expect(ok.headers.get("set-cookie")).toBeNull();
    const unknown = await fetch(site(s.workspace, "/no-such-story/event"), { method: "POST", headers: { origin: `http://${s.workspace}.localhost:${PORT}`, "content-type": "application/json" }, body: '{"type":"view"}' });
    expect(unknown.status, "unknown pages answer like known ones").toBe(204);
    expect((await events(s.id)).length).toBe(1);
  }, 120_000);
});

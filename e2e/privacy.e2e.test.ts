import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { readZip } from "../src/test/zip-reader";
import { removalSecret } from "../src/lib/security/ip-hash";
import { removalToken } from "../src/lib/security/removal";
import { BASE, PORT, createUser, newPage, signIn, startStack, stopStack, type Stack, openVerifiedSigningLink, signStudy } from "./harness";

const CRON_SECRET = "e2e-cron-secret-" + randomBytes(24).toString("hex");
let stack: Stack;

beforeAll(async () => {
  stack = await startStack({ PUBLIC_SITES_DOMAIN: `localhost:${PORT}`, CRON_SECRET });
}, 120_000);
afterAll(async () => {
  await stopStack(stack);
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** A workspace with a published case study, an interview with an upload row and a referral. */
async function tenant(label: string, { plan = "pro" } = {}) {
  const user = await createUser(stack.admin, label);
  const { data: m } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", user.id).single();
  const ws = String(m?.workspace_id);
  const workspace = `pv-${randomBytes(4).toString("hex")}`;
  await stack.admin.from("workspaces").update({ name: `Privacy ${label}`, plan, subdomain_slug: workspace }).eq("id", ws);
  const rawInterview = randomBytes(32).toString("base64url");
  const { data: request } = await stack.admin.from("proof_requests").insert({ workspace_id: ws, client_name: `${label} Client`, client_email: `${label}-client@example.test`, flow_type: "agency", token_hash: sha(rawInterview), expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: "completed" }).select("id").single();
  const { data: interview } = await stack.admin.from("interviews").insert({ request_id: request?.id, workspace_id: ws, status: "completed", consent_given: true, consent_text_version: "v1", question_index: 6, publish_permission: "first_name" }).select("id").single();
  const { data: message } = await stack.admin.from("interview_messages").insert({ interview_id: interview?.id, workspace_id: ws, role: "client", content: "We cut onboarding time by 40 percent." }).select("id").single();
  const upload = `${ws}/${interview?.id}/headshot.webp`;
  await stack.admin.storage.from("uploads").upload(upload, new Uint8Array([82, 73, 70, 70]), { contentType: "image/webp", upsert: true });
  await stack.admin.from("interview_uploads").insert({ interview_id: interview?.id, workspace_id: ws, file_path: upload, kind: "headshot", size_bytes: 4 });
  const { data: draft } = await stack.admin.from("case_studies").insert({ workspace_id: ws, interview_id: interview?.id, content: {}, status: "draft" }).select("id").single();
  const studyId = String(draft?.id);
  const { data: claim } = await stack.admin.from("claims").insert({ case_study_id: studyId, workspace_id: ws, text: "Faster", source_message_id: message?.id, source_quote: "cut onboarding time by 40 percent", client_confirmed: true }).select("id").single();
  const content = { headline: `${label} headline`, client: { name: "Dana" }, sections: [{ type: "challenge", title: "The challenge", body: "Slow." }, { type: "results", title: "Results", metrics: [{ label: "Onboarding time cut", value: "40 percent", claimId: claim?.id }] }], tags: [] };
  await stack.admin.from("case_studies").update({ content }).eq("id", studyId);
  await stack.admin.from("case_study_versions").insert({ case_study_id: studyId, workspace_id: ws, version: 1, content });
  await stack.admin.from("approvals").insert({ case_study_id: studyId, workspace_id: ws, version: 1, approver_email: `${label}-client@example.test`, method: "email_link" });
  const slug = `story-${randomBytes(3).toString("hex")}`;
  await signStudy(stack.admin, String(studyId));
  const res = await stack.admin.from("case_studies").update({ status: "published", slug }).eq("id", studyId);
  if (res.error) throw new Error(res.error.message);
  await stack.admin.from("referrals").insert({ workspace_id: ws, interview_id: interview?.id, referred_name: `${label} Referral`, referred_contact: `${label}-ref@example.test` });
  return { ...user, ws, workspace, slug, studyId, requestId: String(request?.id), interviewId: String(interview?.id), upload, rawInterview };
}

async function open(email: string, password: string) {
  const page = await newPage(stack);
  await signIn(page, email, password);
  await page.waitForURL(`${BASE}/app/dashboard`);
  return page;
}
const site = (workspace: string, path = "/") => `http://${workspace}.localhost:${PORT}${path}`;

describe("export", () => {
  it("the owner downloads a zip of their own data; nobody else can", async () => {
    const t = await tenant("pv-export");
    const other = await tenant("pv-other");
    const page = await open(t.email, t.password);
    await page.goto(`${BASE}/app/settings/privacy`);
    await page.getByRole("heading", { name: "Privacy and data" }).waitFor();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download export/ }).click()]);
    expect(download.suggestedFilename()).toMatch(/^workspace-export-\d{4}-\d\d-\d\d\.zip$/);
    const files = readZip(readFileSync((await download.path())!));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["README.txt", "proof_requests.json", "interview_messages.json", "case_studies.json", "referrals.json", "team.json", "manifest.json"]));
    const all = Buffer.concat(Object.values(files)).toString("utf8");
    expect(all).toContain("pv-export Client");
    expect(all).not.toContain("pv-other");

    // The route itself refuses an editor, a signed-out caller and a cross-site POST.
    const editor = await createUser(stack.admin, "pv-editor", { withWorkspace: false });
    await stack.admin.from("workspace_members").insert({ workspace_id: t.ws, user_id: editor.id, role: "editor" });
    const ePage = await open(editor.email, editor.password);
    const cookies = (await ePage.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
    const post = (headers: Record<string, string>) => fetch(`${BASE}/api/export`, { method: "POST", headers: { origin: BASE, "x-forwarded-for": `198.51.100.${(Date.now() % 200) + 1}`, ...headers } });
    expect((await post({ cookie: cookies })).status, "an editor exported").toBe(403);
    expect((await post({})).status, "signed out").toBe(401);
    expect((await post({ cookie: cookies, origin: "https://evil.example" })).status, "cross-site").toBe(403);
    void other;
  }, 180_000);
});

describe("workspace deletion", () => {
  it("is confirmed by typing the name, takes everything offline at once, can be cancelled, and runs after 30 days", async () => {
    const t = await tenant("pv-del");
    const page = await open(t.email, t.password);
    await page.goto(`${BASE}/app/settings/privacy`);
    const button = page.getByRole("button", { name: "Schedule deletion" });
    expect(await button.isDisabled(), "deletion enabled without confirmation").toBe(true);
    await page.getByLabel(/Type the workspace name/).fill("wrong name");
    expect(await button.isDisabled()).toBe(true);
    expect((await (await fetch(site(t.workspace, `/${t.slug}`))).status)).toBe(200);

    await page.getByLabel(/Type the workspace name/).fill(`Privacy pv-del`);
    await button.click();
    await page.getByText(/Scheduled\. Everything will be deleted on/).waitFor();
    await page.reload();
    await page.getByText(/scheduled for deletion/).first().waitFor();
    expect((await fetch(site(t.workspace, `/${t.slug}`))).status, "the page is still public").toBe(404);
    expect((await fetch(`${BASE}/i/${t.rawInterview}`, { headers: { "x-forwarded-for": "198.51.100.200" } })).status).toBe(404);

    await page.getByRole("button", { name: "Cancel the deletion" }).click();
    await page.getByText(/Deletion cancelled/).waitFor();
    expect((await fetch(site(t.workspace, `/${t.slug}`))).status).toBe(200);

    // Schedule again and let 31 days pass: the daily job removes rows and files.
    await page.getByLabel(/Type the workspace name/).fill("Privacy pv-del");
    await page.getByRole("button", { name: "Schedule deletion" }).click();
    await page.getByText(/Scheduled\./).waitFor();
    await stack.admin.from("workspaces").update({ deletion_requested_at: new Date(Date.now() - 31 * 86_400_000).toISOString() }).eq("id", t.ws);
    const run = (secret?: string) => fetch(`${BASE}/api/cron/purge`, { headers: { "x-forwarded-for": `198.51.100.${(Date.now() % 200) + 1}`, ...(secret ? { authorization: `Bearer ${secret}` } : {}) } });
    expect((await run()).status).toBe(401);
    expect((await run("wrong")).status).toBe(401);
    const ok = await run(CRON_SECRET);
    expect(ok.status).toBe(200);
    expect((await ok.json()).workspaces).toBeGreaterThanOrEqual(1);
    expect((await stack.admin.from("workspaces").select("id").eq("id", t.ws)).data).toHaveLength(0);
    expect((await stack.admin.from("case_studies").select("id").eq("workspace_id", t.ws)).data).toHaveLength(0);
    expect((await stack.admin.storage.from("uploads").list(t.ws)).data ?? []).toHaveLength(0);
  }, 240_000);

  it("is refused while a subscription is active, with a clear explanation", async () => {
    const t = await tenant("pv-sub");
    await stack.admin.from("subscriptions").upsert({ workspace_id: t.ws, stripe_customer_id: `cus_${randomBytes(6).toString("hex")}`, plan: "pro", status: "active" });
    const page = await open(t.email, t.password);
    await page.goto(`${BASE}/app/settings/privacy`);
    await page.getByLabel(/Type the workspace name/).fill("Privacy pv-sub");
    await page.getByRole("button", { name: "Schedule deletion" }).click();
    await page.getByText(/Cancel your subscription first/).waitFor();
    expect((await stack.admin.from("workspaces").select("deletion_requested_at").eq("id", t.ws).single()).data?.deletion_requested_at).toBeNull();
  }, 120_000);
});

describe("delete this interview", () => {
  it("an owner removes the transcript, upload and referral, and the published page comes down", async () => {
    const t = await tenant("pv-int");
    const page = await open(t.email, t.password);
    await page.goto(`${BASE}/app/requests/${t.requestId}`);
    await page.getByRole("button", { name: "Delete this interview" }).click();
    expect(await stack.admin.from("interviews").select("id").eq("id", t.interviewId).then((r) => r.data?.length), "deleted without confirming").toBe(1);
    await page.getByRole("button", { name: "Yes, delete it" }).click();
    await page.getByText(/The interview was deleted/).waitFor();
    for (const table of ["interviews", "interview_messages", "interview_uploads", "referrals", "claims"]) {
      expect((await stack.admin.from(table).select("*", { count: "exact", head: true }).eq("workspace_id", t.ws)).count, table).toBe(0);
    }
    expect((await stack.admin.storage.from("uploads").list(`${t.ws}/${t.interviewId}`)).data ?? []).toHaveLength(0);
    expect((await stack.admin.from("case_studies").select("status").eq("id", t.studyId).single()).data?.status).toBe("unpublished");
    expect((await fetch(site(t.workspace, `/${t.slug}`))).status).toBe(404);
  }, 180_000);

  it("is not offered to editors", async () => {
    const t = await tenant("pv-int-ed");
    const editor = await createUser(stack.admin, "pv-int-editor", { withWorkspace: false });
    await stack.admin.from("workspace_members").insert({ workspace_id: t.ws, user_id: editor.id, role: "editor" });
    const page = await open(editor.email, editor.password);
    await page.goto(`${BASE}/app/requests/${t.requestId}`);
    await page.getByRole("heading", { name: "pv-int-ed Client" }).waitFor();
    expect(await page.getByRole("button", { name: "Delete this interview" }).count()).toBe(0);
  }, 120_000);
});

describe("the client's removal link", () => {
  const secret = () => removalSecret({ SUPABASE_SERVICE_ROLE_KEY: stack.cfg.serviceKey });

  it("needs a confirming click, then erases the story, interview, upload and contact details; bad links are all the same 404", async () => {
    const t = await tenant("pv-rm");
    const keep = await tenant("pv-rm-keep");
    const token = removalToken(secret(), t.studyId);
    const page = await newPage(stack);
    const res = await page.goto(`${BASE}/remove/${token}`);
    expect(res?.status()).toBe(200);
    expect(res?.headers()["x-robots-tag"]).toContain("noindex");
    expect(res?.headers()["cache-control"]).toContain("no-store");
    await page.getByRole("heading", { name: "Remove your story?" }).waitFor();
    expect((await stack.admin.from("case_studies").select("id").eq("id", t.studyId)).data, "opening the link deleted something").toHaveLength(1);

    await page.getByRole("button", { name: "Yes, delete everything" }).click();
    await page.getByRole("heading", { name: "Your story was removed" }).waitFor();
    for (const table of ["case_studies", "case_study_versions", "approvals", "interviews", "interview_messages", "interview_uploads", "referrals", "claims", "proof_requests"]) {
      expect((await stack.admin.from(table).select("*", { count: "exact", head: true }).eq("workspace_id", t.ws)).count, table).toBe(0);
    }
    expect((await stack.admin.storage.from("uploads").list(`${t.ws}/${t.interviewId}`)).data ?? []).toHaveLength(0);
    expect((await fetch(site(t.workspace, `/${t.slug}`))).status).toBe(404);
    expect((await stack.admin.from("case_studies").select("id").eq("id", keep.studyId)).data).toHaveLength(1);

    // The same link now looks like any other unknown link; so do forged and malformed ones.
    for (const bad of [token, removalToken("another-secret", keep.studyId), `${keep.studyId}.AAAA`, "not-a-token", `${keep.studyId}`]) {
      expect((await page.goto(`${BASE}/remove/${encodeURIComponent(bad)}`))?.status(), bad).toBe(404);
    }
    expect((await stack.admin.from("case_studies").select("id").eq("id", keep.studyId)).data).toHaveLength(1);
  }, 180_000);

  it("is on the approval page, which offers it next to approve", async () => {
    const t = await tenant("pv-rm-appr");
    // An approval request in progress for a second study.
    const raw = randomBytes(32).toString("base64url");
    await stack.admin.from("case_studies").update({ status: "awaiting_client_approval" }).eq("id", t.studyId);
    await stack.admin.from("case_study_approval_tokens").insert({ case_study_id: t.studyId, workspace_id: t.ws, version: 1, token_hash: sha(raw) });
    const page = await newPage(stack);
    await openVerifiedSigningLink(page, stack, raw);
    await page.goto(`${BASE}/approve/${raw}`);
    const link = page.getByRole("link", { name: "Delete this story and my interview" });
    await link.waitFor();
    expect(await link.getAttribute("href")).toBe(`/remove/${removalToken(secret(), t.studyId)}`);
  }, 120_000);
});

describe("draft legal pages", () => {
  it("are reachable without signing in, marked draft, kept out of search, and list the subprocessors", async () => {
    for (const path of ["/privacy", "/terms", "/subprocessors", "/dpa"]) {
      const page = await newPage(stack);
      const res = await page.goto(`${BASE}${path}`);
      expect(res?.status(), path).toBe(200);
      await page.getByText("This document has not yet been reviewed by a lawyer").waitFor();
      expect(await page.locator('meta[name="robots"]').getAttribute("content"), path).toContain("noindex");
      expect(await page.getByRole("navigation", { name: "Legal" }).getByRole("link").count()).toBe(4);
    }
    const page = await newPage(stack);
    await page.goto(`${BASE}/subprocessors`);
    const text = await page.locator("main").innerText();
    for (const name of ["Supabase", "Vercel", "Anthropic", "Stripe", "Resend", "Upstash", "Sentry"]) expect(text, name).toContain(name);
    await page.goto(`${BASE}/privacy`);
    const policy = await page.locator("main").innerText();
    for (const promise of ["90 days", "30 day", "never sent", "no cookies"]) expect(policy.toLowerCase(), promise).toContain(promise.toLowerCase());
    await page.goto(`${BASE}/login`);
    await page.getByRole("link", { name: "Privacy" }).waitFor();
  }, 120_000);
});

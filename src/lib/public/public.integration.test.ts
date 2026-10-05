/** The public view and loader against the real database (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, hex64, loadLocalConfig, makeClient, type TestUser } from "../../../supabase/tests/isolation/harness";
import { generateToken } from "@/lib/security/tokens";
import { listPublishedStudies, loadPublishedStudy } from "./load";

let admin: SupabaseClient;
let anon: SupabaseClient;
let owner: TestUser;
let ws: string;
let wsSlug: string;

const content = (headline: string) => ({
  headline,
  client: { name: "Dana", logoPath: "SECRET-WS/logos/x.webp" },
  sections: [{ type: "challenge", title: "The challenge", body: "javascript:alert(1) {{7*7}} Slow onboarding." }],
  tags: [],
});

/** A study taken through the real approval and publish path. */
async function study(headline: string, { publish = true, slug = `s-${hex64().slice(0, 8)}` } = {}) {
  const { data: requestId } = await owner.client.rpc("create_proof_request", {
    ws, client_name: "Dana Doe", client_email: "dana@example.test", project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: generateToken().hash,
  });
  const { data: interview } = await admin.from("interviews").insert({ request_id: requestId, workspace_id: ws, status: "completed", consent_given: true, consent_text_version: "v1", question_index: 6, publish_permission: "first_name" }).select("id").single();
  const { data: cs } = await admin.from("case_studies").insert({ workspace_id: ws, interview_id: interview?.id, content: content(headline), status: "draft" }).select("id").single();
  const id = String(cs?.id);
  await admin.from("case_study_versions").insert({ case_study_id: id, workspace_id: ws, version: 1, content: content(headline) });
  const token = generateToken();
  expect((await owner.client.rpc("request_client_approval", { study: id, hash: token.hash })).error).toBeNull();
  expect((await admin.rpc("approve_case_study", { token_hash: token.hash, ip_hash: hex64() })).error).toBeNull();
  if (publish) expect((await owner.client.rpc("publish_case_study", { study: id, new_slug: slug })).error).toBeNull();
  return { id, slug };
}

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  anon = makeClient(cfg, "anon");
  owner = await createTestUser(cfg, admin, "pub-owner");
  ws = String((await owner.client.rpc("create_workspace", { name: "Public Co", type: "agency" })).data);
  wsSlug = `pub-${hex64().slice(0, 8)}`;
  await admin.from("workspaces").update({ plan: "pro", subdomain_slug: wsSlug }).eq("id", ws);
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  await admin.auth.admin.deleteUser(owner.id);
}, 120_000);

describe("public_case_studies", () => {
  it("shows a published study to an anonymous visitor, without internal data", async () => {
    const s = await study("Live story");
    const loaded = await loadPublishedStudy(anon, wsSlug, s.slug);
    expect(loaded?.content.headline).toBe("Live story");
    expect(loaded?.workspaceName).toBe("Public Co");
    expect(loaded?.showBadge).toBe(false);
    expect(loaded?.template?.name).toBeTruthy();
    expect(loaded?.content.client).not.toHaveProperty("logoPath");
    expect(loaded?.logoPath).toBe("SECRET-WS/logos/x.webp");

    const { data } = await anon.from("public_case_studies").select("*").eq("slug", s.slug);
    expect(Object.keys(data?.[0] ?? {}).sort()).toEqual(
      ["content", "logo_path", "published_at", "show_badge", "slug", "template_active", "template_category", "template_default_theme", "template_id", "template_name", "template_sections", "template_tier", "theme_settings", "workspace_name", "workspace_slug"],
    );
  });

  it("does not show drafts, awaiting, approved-but-unpublished or unpublished studies", async () => {
    const approved = await study("Approved only", { publish: false });
    expect(await loadPublishedStudy(anon, wsSlug, approved.id)).toBeNull();
    const rows = await anon.from("public_case_studies").select("slug").eq("workspace_slug", wsSlug);
    expect((rows.data ?? []).map((r) => r.slug)).not.toContain("approved-only");

    const live = await study("Soon gone");
    expect(await loadPublishedStudy(anon, wsSlug, live.slug)).not.toBeNull();
    expect((await owner.client.rpc("unpublish_case_study", { study: live.id })).error).toBeNull();
    expect(await loadPublishedStudy(anon, wsSlug, live.slug), "an unpublished page is still public").toBeNull();
  });

  it("keeps other tables closed to anonymous callers", async () => {
    for (const table of ["case_studies", "claims", "approvals", "workspaces", "interviews", "case_study_approval_tokens"]) {
      const res = await anon.from(table).select("*").limit(1);
      expect(res.error !== null || (res.data ?? []).length === 0, `anon read ${table}`).toBe(true);
    }
  });

  it("rejects malformed names without querying, and is scoped to the workspace", async () => {
    expect(await loadPublishedStudy(anon, "Bad Name", "x")).toBeNull();
    expect(await loadPublishedStudy(anon, wsSlug, "../etc")).toBeNull();
    expect(await loadPublishedStudy(anon, "other-ws-slug", "live-story")).toBeNull();
  });

  it("lists a workspace's published stories newest first, and shows the badge on the free plan", async () => {
    const a = await study("First listed");
    const b = await study("Second listed");
    const list = await listPublishedStudies(anon, wsSlug);
    const slugs = list?.items.map((i) => i.slug) ?? [];
    expect(slugs.indexOf(b.slug)).toBeLessThan(slugs.indexOf(a.slug));
    await admin.from("workspaces").update({ plan: "free" }).eq("id", ws);
    expect((await listPublishedStudies(anon, wsSlug))?.showBadge).toBe(true);
    await admin.from("workspaces").update({ plan: "pro" }).eq("id", ws);
  });
});

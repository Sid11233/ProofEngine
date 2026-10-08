/**
 * Tenant isolation suite (Phase 1.4). Runs against a LOCAL Supabase through the
 * real REST API, with real users, so it proves what a hostile client can do.
 *
 *   npx supabase start && npm run test:isolation
 *
 * For every tenant table it checks that:
 *   1. user B (another workspace) cannot select, insert, update or delete A's rows,
 *      including inserting a row with workspace_id = A when the payload is valid;
 *   2. an anonymous client reads and writes nothing;
 *   3. user C (viewer in A) can read but not write;
 *   4. append-only tables reject update and delete for every role, owner included;
 *   5. token_hash cannot be read, filtered on or written through the client API.
 * Failure messages start with the table name.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestUser,
  signCurrent,
  hex64,
  inDays,
  loadLocalConfig,
  makeClient,
  must,
  rowsOf,
  slug,
  wasBlocked,
  type LocalConfig,
  type Row,
  type TestUser,
} from "./harness";

interface Tenant {
  ws: string;
  ownerId: string;
  requestId: string;
  interviewId: string;
  messageId: string;
  caseStudyId: string;
  demoId: string;
  clientId: string;
  projectId: string;
}

const CLIENT_SENTENCE = "We cut costs by 40 percent.";
const CLIENT_QUOTE = "cut costs by 40 percent";
const INSERT_MARKER = "ISOLATION-INSERT-MARKER";

let cfg: LocalConfig;
let admin: SupabaseClient;
let anon: SupabaseClient;
let A: TestUser; // owner of workspace A
let B: TestUser; // owner of workspace B
let C: TestUser; // viewer in A
let D: TestUser; // editor in A
let E: TestUser; // admin in A
let F: TestUser; // belongs to no workspace
let tenantA: Tenant;
let tenantB: Tenant;
let wsA2: string; // second, empty workspace owned by A (avoids PK collisions in insert attacks)
let template1: string;
let template2: string;
const createdWorkspaces: string[] = [];
const createdUsers: string[] = [];

async function newWorkspace(user: TestUser, name: string): Promise<string> {
  const { data, error } = await user.client.rpc("create_workspace", { name, type: "agency" });
  if (error || typeof data !== "string") throw new Error(`create_workspace failed: ${error?.message}`);
  createdWorkspaces.push(data);
  return data;
}

async function seedTenant(ws: string, ownerId: string): Promise<Tenant> {
  const request = await must(
    admin
      .from("proof_requests")
      .insert({
        workspace_id: ws,
        created_by: ownerId,
        client_name: "Seed Client",
        client_email: "seed@example.com",
        flow_type: "agency",
        token_hash: hex64(),
        expires_at: inDays(30),
      })
      .select()
      .single(),
    "proof_requests",
  );
  const interview = await must(
    admin.from("interviews").insert({ request_id: request.id, workspace_id: ws }).select().single(),
    "interviews",
  );
  const message = await must(
    admin
      .from("interview_messages")
      .insert({ interview_id: interview.id, workspace_id: ws, role: "client", content: CLIENT_SENTENCE })
      .select()
      .single(),
    "interview_messages",
  );
  await must(
    admin
      .from("interview_uploads")
      .insert({ interview_id: interview.id, workspace_id: ws, file_path: "seed/logo.webp", kind: "logo", size_bytes: 100 })
      .select(),
    "interview_uploads",
  );
  await must(
    admin
      .from("referrals")
      .insert({ workspace_id: ws, interview_id: interview.id, referred_name: "Ref", referred_contact: "ref@example.com" })
      .select(),
    "referrals",
  );
  await must(
    admin.from("question_flows").insert({ workspace_id: ws, type: "custom", name: "Seed flow", questions: [] }).select(),
    "question_flows",
  );
  await must(
    admin.from("template_entitlements").insert({ workspace_id: ws, template_id: template1, source: "plan" }).select(),
    "template_entitlements",
  );
  const caseStudy = await must(
    admin
      .from("case_studies")
      .insert({ workspace_id: ws, interview_id: interview.id, template_id: template1, content: {}, slug: slug() })
      .select()
      .single(),
    "case_studies",
  );
  for (const version of [1, 2]) {
    await must(
      admin
        .from("case_study_versions")
        .insert({ case_study_id: caseStudy.id, workspace_id: ws, version, content: {}, created_by: ownerId })
        .select(),
      "case_study_versions",
    );
  }
  await must(
    admin
      .from("claims")
      .insert({
        case_study_id: caseStudy.id,
        workspace_id: ws,
        text: "Costs fell by 40 percent",
        source_message_id: message.id,
        source_quote: CLIENT_QUOTE,
      })
      .select(),
    "claims",
  );
  await must(
    admin
      .from("approvals")
      .insert({ case_study_id: caseStudy.id, workspace_id: ws, version: 1, approver_email: "seed@example.com", method: "email_link" })
      .select(),
    "approvals",
  );
  // An approval token (never selectable by clients) and one piece of client feedback, made the way the app makes them.
  await must(
    admin
      .from("case_study_approval_tokens")
      .insert({ case_study_id: caseStudy.id, workspace_id: ws, version: 1, token_hash: hex64() })
      .select(),
    "case_study_approval_tokens",
  );
  const feedbackToken = hex64();
  await admin.from("case_studies").update({ status: "awaiting_client_approval" }).eq("id", caseStudy.id);
  await must(
    admin.from("case_study_approval_tokens").insert({ case_study_id: caseStudy.id, workspace_id: ws, version: 2, token_hash: feedbackToken }).select(),
    "case_study_approval_tokens",
  );
  await admin.from("case_studies").update({ current_version: 2 }).eq("id", caseStudy.id);
  const changes = await admin.rpc("request_case_study_changes", { token_hash: feedbackToken, note: "Seed note", ip_hash: hex64() });
  if (changes.error) throw new Error(`seed feedback: ${changes.error.message}`);
  await must(admin.from("wall_settings").insert({ workspace_id: ws, enabled: false }).select(), "wall_settings");
  await must(admin.from("workspace_communities").insert({ workspace_id: ws, community_id: "b0000000-0000-4000-8000-000000000001", status: "saved", notes: "seed" }).select(), "workspace_communities");
  await must(admin.from("social_profiles").insert({ workspace_id: ws, network: "linkedin", url: "https://www.linkedin.com/company/seed" }).select(), "social_profiles");
  const signatureId = await signCurrent(admin, String(caseStudy.id), { social: true });
  await must(admin.from("social_posts").insert({ workspace_id: ws, case_study_id: caseStudy.id, network: "x", variant: 1, body: "Seed draft" }).select(), "social_posts");
  await must(admin.from("signature_events").insert({ workspace_id: ws, case_study_id: caseStudy.id, signature_id: signatureId, event: "signed" }).select(), "signature_events");
  const second = await signCurrent(admin, String(caseStudy.id));
  await must(admin.from("signature_revocations").insert({ workspace_id: ws, signature_id: second, method: "email_link", reason: "seed" }).select(), "signature_revocations");
  await must(admin.from("text_refinements").insert({ workspace_id: ws, case_study_id: caseStudy.id, version: 1, field_path: "headline", original_text: "a", suggested_text: "b" }).select(), "text_refinements");
  const client = await must(admin.from("clients").insert({ workspace_id: ws, created_by: ownerId, name: "Seed client", contact_email: "client@example.test" }).select("id").single(), "clients");
  const clientId = String((client as { id: string }).id);
  const project = await must(admin.from("projects").insert({ workspace_id: ws, client_id: clientId, created_by: ownerId, name: "Seed project" }).select("id").single(), "projects");
  const projectId = String((project as { id: string }).id);
  await must(admin.from("project_links").insert({ workspace_id: ws, project_id: projectId, label: "Seed", url: "https://example.com" }).select(), "project_links");
  await must(admin.from("project_feedback").insert({ workspace_id: ws, project_id: projectId, created_by: ownerId, body: "Seed feedback" }).select(), "project_feedback");
  const demo = await must(admin.from("demos").insert({ workspace_id: ws, created_by: ownerId, title: "Seed demo" }).select("id").single(), "demos");
  const demoId = String((demo as { id: string }).id);
  await must(admin.from("demo_versions").insert({ demo_id: demoId, workspace_id: ws, version: 1, content: { scenes: [] } }).select(), "demo_versions");
  await must(admin.from("demo_assets").insert({ workspace_id: ws, demo_id: demoId, file_path: `${ws}/${demoId}/${"a".repeat(8)}-aaaa-aaaa-aaaa-${"a".repeat(12)}.webp`, kind: "screenshot", width: 100, height: 100, size_bytes: 1000, sha256: "a".repeat(64), flagged: true, flag_reason: "seed" }).select(), "demo_assets");
  await must(admin.from("demo_embed_origins").insert({ demo_id: demoId, workspace_id: ws, origin: "https://example.com" }).select(), "demo_embed_origins");
  await must(admin.from("demo_leads").insert({ workspace_id: ws, demo_id: demoId, email: "lead@example.test", name: "Lead", consent: true, consent_text_version: "demo-lead-v1" }).select(), "demo_leads");
  await must(admin.from("demo_events").insert({ workspace_id: ws, demo_id: demoId, type: "view" }).select(), "demo_events");
  await must(admin.from("push_subscriptions").insert({ user_id: ownerId, workspace_id: ws, endpoint: "https://fcm.googleapis.com/fcm/send/seedseedseedseedseed", p256dh: "A".repeat(87), auth: "z".repeat(22) }).select(), "push_subscriptions");
  await must(admin.from("notification_preferences").insert({ user_id: ownerId, workspace_id: ws }).select(), "notification_preferences");
  await must(
    admin
      .from("takedown_requests")
      .insert({ case_study_id: caseStudy.id, workspace_id: ws, reason: "Seed", contact_email: "t@example.com" })
      .select(),
    "takedown_requests",
  );
  await must(admin.from("subscriptions").insert({ workspace_id: ws, plan: "free" }).select(), "subscriptions");
  await must(
    admin.from("usage_counters").insert({ workspace_id: ws, period: "2026-10-01", ai_messages: 1 }).select(),
    "usage_counters",
  );
  await must(admin.from("audit_log").insert({ workspace_id: ws, actor: ownerId, action: "seed.event" }).select(), "audit_log");
  await must(
    admin.from("page_events").insert({ case_study_id: caseStudy.id, workspace_id: ws, type: "view" }).select(),
    "page_events",
  );
  return {
    ws,
    ownerId,
    requestId: request.id,
    interviewId: interview.id,
    messageId: message.id,
    caseStudyId: caseStudy.id,
    demoId,
    clientId,
    projectId,
  };
}

beforeAll(async () => {
  cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  anon = makeClient(cfg, "anon");

  [A, B, C, D, E, F] = await Promise.all(
    ["a-owner", "b-owner", "c-viewer", "d-editor", "e-admin", "f-spare"].map((label) =>
      createTestUser(cfg, admin, label),
    ),
  );
  createdUsers.push(A.id, B.id, C.id, D.id, E.id, F.id);

  const wsA = await newWorkspace(A, "Isolation A");
  wsA2 = await newWorkspace(A, "Isolation A2");
  const wsB = await newWorkspace(B, "Isolation B");

  await must(
    admin
      .from("workspace_members")
      .insert([
        { workspace_id: wsA, user_id: C.id, role: "viewer" },
        { workspace_id: wsA, user_id: D.id, role: "editor" },
        { workspace_id: wsA, user_id: E.id, role: "admin" },
      ])
      .select(),
    "workspace_members",
  );

  const templates = await must(
    admin
      .from("templates")
      .insert([
        { name: "Isolation T1", tier: "free" },
        { name: "Isolation T2", tier: "pro" },
      ])
      .select(),
    "templates",
  );
  template1 = templates[0].id;
  template2 = templates[1].id;

  tenantA = await seedTenant(wsA, A.id);
  tenantB = await seedTenant(wsB, B.id);
}, 120_000);

afterAll(async () => {
  // Best-effort cleanup. Workspaces first: the last-owner guard blocks deleting
  // an owner's auth user while their workspace still exists.
  if (!admin) return;
  await admin.from("question_flows").delete().is("workspace_id", null).eq("name", "System flow");
  for (const ws of createdWorkspaces) await admin.from("workspaces").delete().eq("id", ws);
  await admin.from("templates").delete().in("id", [template1, template2].filter(Boolean));
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
}, 120_000);

// ---------------------------------------------------------------------------
// Per-table checks
// ---------------------------------------------------------------------------

type Op = "update" | "delete" | "insert";

interface Spec {
  table: string;
  tenantCol?: string;
  columns?: string;
  /** Lowest role that can read rows. */
  readRole: "viewer" | "editor" | "admin" | "owner";
  /** A harmless-looking column change an attacker would try. */
  patch: Row;
  /** A payload that would be valid if the caller were allowed to insert into tenant `t`. */
  insert: (t: Tenant, actor: string) => Row;
  appendOnly?: boolean;
}

const SPECS: Spec[] = [
  {
    table: "workspaces",
    tenantCol: "id",
    columns: "id,name,plan",
    readRole: "viewer",
    patch: { name: "HACKED" },
    insert: () => ({ name: INSERT_MARKER, type: "agency" }),
  },
  {
    table: "workspace_members",
    readRole: "viewer",
    patch: { role: "admin" },
    insert: (t) => ({ workspace_id: t.ws, user_id: F.id, role: "viewer" }),
  },
  {
    table: "proof_requests",
    columns: "id,workspace_id,client_name,status,created_at",
    readRole: "viewer",
    patch: { client_name: "HACKED" },
    insert: (t, actor) => ({
      workspace_id: t.ws,
      created_by: actor,
      client_name: "Injected",
      client_email: "x@example.com",
      flow_type: "agency",
      token_hash: hex64(),
      expires_at: inDays(30),
    }),
  },
  {
    table: "interviews",
    readRole: "viewer",
    patch: { status: "completed" },
    insert: (t) => ({ request_id: t.requestId, workspace_id: t.ws }),
  },
  {
    table: "interview_messages",
    readRole: "viewer",
    patch: { content: "HACKED" },
    insert: (t) => ({ interview_id: t.interviewId, workspace_id: t.ws, role: "client", content: "Injected" }),
  },
  {
    table: "interview_uploads",
    readRole: "viewer",
    patch: { size_bytes: 1 },
    insert: (t) => ({ interview_id: t.interviewId, workspace_id: t.ws, file_path: "x/y.webp", kind: "logo", size_bytes: 1 }),
  },
  {
    table: "referrals",
    readRole: "viewer",
    patch: { status: "won" },
    insert: (t) => ({ workspace_id: t.ws, interview_id: t.interviewId, referred_name: "X", referred_contact: "y" }),
  },
  {
    table: "question_flows",
    readRole: "viewer",
    patch: { name: "HACKED" },
    insert: (t) => ({ workspace_id: t.ws, type: "custom", name: "Injected", questions: [] }),
  },
  {
    table: "template_entitlements",
    readRole: "viewer",
    patch: { source: "purchase" },
    insert: (t) => ({ workspace_id: t.ws, template_id: template2, source: "purchase" }),
  },
  {
    table: "case_studies",
    readRole: "viewer",
    patch: { content: { headline: "HACKED" } },
    insert: (t) => ({ workspace_id: t.ws, interview_id: t.interviewId, content: {}, slug: slug() }),
  },
  {
    table: "case_study_versions",
    readRole: "viewer",
    appendOnly: true,
    patch: { content: { tampered: true } },
    insert: (t, actor) => ({ case_study_id: t.caseStudyId, workspace_id: t.ws, version: 9, content: {}, created_by: actor }),
  },
  {
    table: "claims",
    readRole: "viewer",
    patch: { client_confirmed: true },
    insert: (t) => ({
      case_study_id: t.caseStudyId,
      workspace_id: t.ws,
      text: "Injected",
      source_message_id: t.messageId,
      source_quote: CLIENT_QUOTE,
    }),
  },
  {
    table: "approvals",
    readRole: "viewer",
    appendOnly: true,
    patch: { approver_email: "evil@example.com" },
    insert: (t) => ({ case_study_id: t.caseStudyId, workspace_id: t.ws, version: 2, approver_email: "evil@example.com", method: "email_link" }),
  },
  {
    table: "case_study_approval_tokens",
    columns: "id,case_study_id,workspace_id,version,expires_at,used_at,revoked_at",
    readRole: "editor",
    patch: { revoked_at: "2030-01-01T00:00:00Z" },
    insert: (t) => ({ case_study_id: t.caseStudyId, workspace_id: t.ws, version: 1, token_hash: hex64() }),
  },
  {
    table: "case_study_feedback",
    readRole: "editor",
    appendOnly: true,
    patch: { message: "edited" },
    insert: (t) => ({ case_study_id: t.caseStudyId, workspace_id: t.ws, version: 1, kind: "declined", message: "x" }),
  },
  {
    table: "push_subscriptions",
    tenantCol: "workspace_id",
    columns: "id,user_id,workspace_id,endpoint",
    // Per-user rows: only the user they belong to (the workspace owner A in the fixtures) can read them.
    readRole: "owner",
    patch: { endpoint: "https://evil.example/push/hijack-0000000000" },
    insert: (t, actor) => ({ user_id: actor, workspace_id: t.ws, endpoint: "https://fcm.googleapis.com/fcm/send/xxxxxxxxxxxxxxxxxxxx", p256dh: "B".repeat(87), auth: "a".repeat(22) }),
  },
  {
    table: "notification_preferences",
    tenantCol: "workspace_id",
    readRole: "owner",
    patch: { client_completed: true },
    insert: (t, actor) => ({ user_id: actor, workspace_id: t.ws, client_completed: true }),
  },
  {
    table: "workspace_communities",
    tenantCol: "workspace_id",
    readRole: "editor",
    patch: { notes: "HACKED" },
    insert: (t) => ({ workspace_id: t.ws, community_id: "b0000000-0000-4000-8000-000000000002", status: "joined" }),
  },
  {
    table: "social_profiles",
    tenantCol: "workspace_id",
    readRole: "viewer",
    patch: { url: "https://www.linkedin.com/company/hacked" },
    insert: (t) => ({ workspace_id: t.ws, network: "x", url: "https://x.com/hacked" }),
  },
  {
    table: "social_posts",
    tenantCol: "workspace_id",
    readRole: "editor",
    patch: { status: "posted" },
    insert: (t) => ({ workspace_id: t.ws, case_study_id: t.ws, network: "x", variant: 9, body: "Hacked" }),
  },
  {
    table: "signatures",
    tenantCol: "workspace_id",
    columns: "id,workspace_id,signer_name,consent_web",
    readRole: "viewer",
    patch: { signer_name: "HACKED" },
    insert: (t) => ({ workspace_id: t.ws, case_study_id: t.ws, version: 1, signer_name: "x", signer_email: "x@example.test" }),
  },
  {
    table: "signature_revocations",
    tenantCol: "workspace_id",
    readRole: "viewer",
    patch: { reason: "HACKED" },
    insert: (t) => ({ workspace_id: t.ws, signature_id: t.ws, method: "x" }),
  },
  {
    table: "signature_events",
    tenantCol: "workspace_id",
    columns: "id,workspace_id,event",
    readRole: "admin",
    patch: { event: "declined" },
    insert: (t) => ({ workspace_id: t.ws, case_study_id: t.ws, event: "signed" }),
  },
  {
    table: "text_refinements",
    tenantCol: "workspace_id",
    readRole: "editor",
    patch: { accepted: true },
    insert: (t) => ({ workspace_id: t.ws, case_study_id: t.ws, version: 1, field_path: "headline", original_text: "a", suggested_text: "b" }),
  },
  {
    table: "wall_settings",
    tenantCol: "workspace_id",
    readRole: "admin",
    patch: { enabled: true },
    insert: (t) => ({ workspace_id: t.ws, enabled: false }),
  },
  {
    table: "takedown_requests",
    readRole: "admin",
    patch: { status: "dismissed" },
    insert: (t) => ({ case_study_id: t.caseStudyId, workspace_id: t.ws, reason: "Injected", contact_email: "x@example.com" }),
  },
  {
    table: "subscriptions",
    readRole: "viewer",
    patch: { plan: "team" },
    // Targets the empty workspace so a primary-key collision cannot mask a missing policy.
    insert: () => ({ workspace_id: wsA2, plan: "team" }),
  },
  {
    table: "usage_counters",
    readRole: "viewer",
    patch: { ai_messages: 0 },
    insert: (t) => ({ workspace_id: t.ws, period: "2026-11-01", ai_messages: 0 }),
  },
  {
    table: "audit_log",
    readRole: "admin",
    appendOnly: true,
    patch: { action: "tampered" },
    insert: (t, actor) => ({ workspace_id: t.ws, actor, action: "injected.event" }),
  },
  {
    table: "clients",
    readRole: "viewer",
    patch: { name: "HACKED" },
    insert: (t, actor) => ({ workspace_id: t.ws, created_by: actor, name: INSERT_MARKER }),
  },
  {
    table: "projects",
    readRole: "viewer",
    patch: { name: "HACKED" },
    insert: (t, actor) => ({ workspace_id: t.ws, client_id: t.clientId, created_by: actor, name: INSERT_MARKER }),
  },
  {
    table: "project_links",
    readRole: "viewer",
    patch: { label: "HACKED" },
    insert: (t) => ({ workspace_id: t.ws, project_id: t.projectId, label: INSERT_MARKER, url: "https://example.com/x" }),
  },
  {
    table: "project_feedback",
    readRole: "viewer",
    patch: { body: "HACKED" },
    insert: (t, actor) => ({ workspace_id: t.ws, project_id: t.projectId, created_by: actor, body: INSERT_MARKER }),
  },
  {
    table: "demos",
    readRole: "viewer",
    patch: { title: "HACKED" },
    insert: (t, actor) => ({ workspace_id: t.ws, created_by: actor, title: INSERT_MARKER }),
  },
  {
    table: "demo_versions",
    readRole: "viewer",
    appendOnly: true,
    patch: { content: { tampered: true } },
    insert: (t, actor) => ({ demo_id: t.demoId, workspace_id: t.ws, version: 9, content: {}, created_by: actor }),
  },
  {
    table: "demo_assets",
    readRole: "viewer",
    patch: { flagged: false },
    insert: (t) => ({ workspace_id: t.ws, demo_id: t.demoId, file_path: "x", kind: "screenshot", width: 1, height: 1, size_bytes: 1, sha256: "b".repeat(64) }),
  },
  {
    table: "demo_embed_origins",
    readRole: "viewer",
    patch: { origin: "https://hacked.example" },
    insert: (t) => ({ demo_id: t.demoId, workspace_id: t.ws, origin: "https://insert.example" }),
  },
  {
    table: "demo_leads",
    readRole: "viewer",
    patch: { name: "HACKED" },
    insert: (t) => ({ workspace_id: t.ws, demo_id: t.demoId, email: "x@example.test", consent: true, consent_text_version: "demo-lead-v1" }),
  },
  {
    table: "demo_events",
    readRole: "viewer",
    appendOnly: true,
    patch: { type: "complete" },
    insert: (t) => ({ workspace_id: t.ws, demo_id: t.demoId, type: "view" }),
  },
  {
    table: "page_events",
    readRole: "viewer",
    patch: { type: "cta_click" },
    insert: (t) => ({ case_study_id: t.caseStudyId, workspace_id: t.ws, type: "view" }),
  },
];

const tenantCol = (spec: Spec) => spec.tenantCol ?? "workspace_id";
const cols = (spec: Spec) => spec.columns ?? "*";
const workspaceIdsOfA = () => [tenantA.ws, wsA2];

async function snapshot(spec: Spec): Promise<string[]> {
  const { data, error } = await admin.from(spec.table).select("*").in(tenantCol(spec), workspaceIdsOfA());
  if (error) throw new Error(`${spec.table}: snapshot failed: ${error.message}`);
  return (data as Row[]).map((row) => JSON.stringify(row)).sort();
}

/** Fires write attempts as `client` against workspace A's rows; errors are expected and ignored. */
async function attack(client: SupabaseClient, spec: Spec, actorId: string, ops: Op[]): Promise<void> {
  const col = tenantCol(spec);
  // Leaving a workspace is legitimate, so membership attacks target other people's rows.
  const others = <T extends { neq: (c: string, v: string) => T }>(q: T) =>
    spec.table === "workspace_members" ? q.neq("user_id", actorId) : q;

  if (ops.includes("update")) await others(client.from(spec.table).update(spec.patch).in(col, workspaceIdsOfA())).select();
  if (ops.includes("delete")) await others(client.from(spec.table).delete().in(col, workspaceIdsOfA())).select();
  if (ops.includes("insert")) await client.from(spec.table).insert(spec.insert(tenantA, actorId)).select();
}

async function expectNoWrites(
  spec: Spec,
  who: string,
  client: SupabaseClient,
  actorId: string,
  ops: Op[] = ["update", "delete", "insert"],
) {
  const before = await snapshot(spec);
  await attack(client, spec, actorId, ops);
  const after = await snapshot(spec);
  expect(after, `${spec.table}: ${who} modified workspace A rows`).toEqual(before);

  if (spec.table === "workspaces") {
    const { data } = await admin.from("workspaces").select("id").eq("name", INSERT_MARKER);
    expect(data ?? [], `workspaces: ${who} created a workspace by direct insert`).toHaveLength(0);
  }
}

describe.each(SPECS)("tenant isolation: $table", (spec) => {
  it("positive control: the owner of A can read A's seeded rows", async () => {
    const res = await A.client.from(spec.table).select(cols(spec)).in(tenantCol(spec), [tenantA.ws]);
    expect(res.error, `${spec.table}: owner read failed`).toBeNull();
    expect(rowsOf(res).length, `${spec.table}: owner cannot see own rows (test setup broken?)`).toBeGreaterThan(0);
  });

  it("1a. user B cannot read A's rows", async () => {
    const filtered = await B.client.from(spec.table).select(cols(spec)).in(tenantCol(spec), workspaceIdsOfA());
    expect(rowsOf(filtered), `${spec.table}: B read A's rows with a filter`).toHaveLength(0);

    const everything = await B.client.from(spec.table).select(cols(spec));
    const leaked = rowsOf(everything).filter((row) => workspaceIdsOfA().includes(String(row[tenantCol(spec)])));
    expect(leaked, `${spec.table}: B's unfiltered read includes A's rows`).toHaveLength(0);
    // Control: the same read does return B's own rows, so an empty result above means isolation, not a broken query.
    const own = rowsOf(everything).filter((row) => row[tenantCol(spec)] === tenantB.ws);
    expect(own.length, `${spec.table}: B cannot read its own rows (test setup broken?)`).toBeGreaterThan(0);
  });

  it("1b. user B cannot update, delete, or insert into A (even with a valid payload)", async () => {
    await expectNoWrites(spec, "user B", B.client, B.id);
  });

  it("2. an anonymous client reads nothing and writes nothing", async () => {
    const res = await anon.from(spec.table).select(cols(spec));
    expect(rowsOf(res), `${spec.table}: anonymous client can read rows`).toHaveLength(0);
    await expectNoWrites(spec, "anonymous client", anon, B.id);
  });

  it("3. viewer C: reads according to role, cannot write", async () => {
    const res = await C.client.from(spec.table).select(cols(spec)).in(tenantCol(spec), [tenantA.ws]);
    if (spec.readRole === "viewer") {
      expect(rowsOf(res).length, `${spec.table}: viewer cannot read rows they should see`).toBeGreaterThan(0);
    } else {
      expect(rowsOf(res), `${spec.table}: viewer can read admin-only rows`).toHaveLength(0);
    }
    await expectNoWrites(spec, "viewer C", C.client, C.id);
  });

  if (spec.readRole === "editor") {
    it("3c. editor D can read these rows", async () => {
      const asEditor = await D.client.from(spec.table).select(cols(spec)).in(tenantCol(spec), [tenantA.ws]);
      expect(rowsOf(asEditor).length, `${spec.table}: editor cannot read rows they should see`).toBeGreaterThan(0);
    });
  }

  if (spec.readRole === "owner") {
    it("3d. only the row's own user can read it: not a viewer, editor, admin or owner of another account", async () => {
      for (const [who, user] of [["viewer C", C], ["editor D", D], ["admin E", E]] as const) {
        const res = await user.client.from(spec.table).select(cols(spec)).in(tenantCol(spec), [tenantA.ws]);
        expect(rowsOf(res), `${spec.table}: ${who} read someone else's rows`).toHaveLength(0);
      }
    });
  }

  if (spec.readRole === "admin") {
    it("3b. editor D cannot read admin-only rows, admin E can", async () => {
      const asEditor = await D.client.from(spec.table).select(cols(spec)).in(tenantCol(spec), [tenantA.ws]);
      expect(rowsOf(asEditor), `${spec.table}: editor can read admin-only rows`).toHaveLength(0);
      const asAdmin = await E.client.from(spec.table).select(cols(spec)).in(tenantCol(spec), [tenantA.ws]);
      expect(rowsOf(asAdmin).length, `${spec.table}: admin cannot read admin-only rows`).toBeGreaterThan(0);
    });
  }

  if (spec.appendOnly) {
    it("5. rejects update and delete for every role, owner included", async () => {
      for (const [who, user] of [["owner A", A], ["admin E", E], ["editor D", D]] as const) {
        await expectNoWrites(spec, who, user.client, user.id, ["update", "delete"]);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 6. token_hash is never exposed
// ---------------------------------------------------------------------------

describe("proof_requests.token_hash", () => {
  it("cannot be selected directly", async () => {
    const res = await A.client.from("proof_requests").select("token_hash");
    expect(res.error, "proof_requests: token_hash is selectable by the owner").not.toBeNull();
  });

  it("is not returned by select * on the table", async () => {
    const res = await A.client.from("proof_requests").select("*");
    const leaked = rowsOf(res).some((row) => "token_hash" in row);
    expect(leaked, "proof_requests: select * returned token_hash").toBe(false);
  });

  it("cannot be used as a filter (no existence oracle)", async () => {
    const { data: seeded } = await admin.from("proof_requests").select("token_hash").eq("id", tenantA.requestId).single();
    const probe = await B.client.from("proof_requests").select("id").eq("token_hash", String(seeded?.token_hash));
    expect(probe.error, "proof_requests: token_hash can be probed with a filter").not.toBeNull();
    const probeOwner = await A.client.from("proof_requests").select("id").eq("token_hash", String(seeded?.token_hash));
    expect(probeOwner.error, "proof_requests: owner can probe token_hash with a filter").not.toBeNull();
  });

  it("cannot be overwritten by an editor", async () => {
    const { data: before } = await admin.from("proof_requests").select("token_hash").eq("id", tenantA.requestId).single();
    await D.client.from("proof_requests").update({ token_hash: hex64() }).eq("id", tenantA.requestId).select();
    const { data: after } = await admin.from("proof_requests").select("token_hash").eq("id", tenantA.requestId).single();
    expect(after?.token_hash, "proof_requests: editor changed token_hash").toBe(before?.token_hash);
  });

  it("is absent from proof_requests_safe, which still enforces tenant isolation", async () => {
    const own = await A.client.from("proof_requests_safe").select("*");
    expect(rowsOf(own).length, "proof_requests_safe: owner sees nothing").toBeGreaterThan(0);
    expect(rowsOf(own).some((row) => "token_hash" in row), "proof_requests_safe: exposes token_hash").toBe(false);
    expect(rowsOf(own).every((row) => row.workspace_id === tenantA.ws), "proof_requests_safe: leaks another workspace").toBe(true);

    const hash = await A.client.from("proof_requests_safe").select("token_hash");
    expect(hash.error, "proof_requests_safe: token_hash column exists").not.toBeNull();

    const other = await B.client.from("proof_requests_safe").select("*").eq("workspace_id", tenantA.ws);
    expect(rowsOf(other), "proof_requests_safe: B reads A's requests").toHaveLength(0);

    const anonymous = await anon.from("proof_requests_safe").select("*");
    expect(rowsOf(anonymous), "proof_requests_safe: anonymous reads rows").toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Profiles, templates, system flows
// ---------------------------------------------------------------------------

describe("profiles", () => {
  it("a user reads only their own profile, and anonymous reads none", async () => {
    const own = await B.client.from("profiles").select("id,email");
    expect(rowsOf(own).map((r) => r.id), "profiles: B sees other users' profiles").toEqual([B.id]);
    expect(rowsOf(await anon.from("profiles").select("id")), "profiles: anonymous can read").toHaveLength(0);
  });

  it("a user cannot update someone else's profile or their own email", async () => {
    await B.client.from("profiles").update({ full_name: "HACKED" }).eq("id", A.id).select();
    const { data } = await admin.from("profiles").select("full_name").eq("id", A.id).single();
    expect(data?.full_name, "profiles: B changed A's profile").not.toBe("HACKED");

    const email = await B.client.from("profiles").update({ email: "spoof@example.com" }).eq("id", B.id).select();
    expect(email.error, "profiles: email is client-writable").not.toBeNull();

    const name = await B.client.from("profiles").update({ full_name: "Bee" }).eq("id", B.id).select();
    expect(name.error, "profiles: own full_name should be updatable").toBeNull();
    expect(rowsOf(name)).toHaveLength(1);
  });
});

describe("templates and system flows", () => {
  it("templates are readable when signed in, never to anonymous, and never writable", async () => {
    expect(rowsOf(await A.client.from("templates").select("id")).length).toBeGreaterThan(0);
    expect(rowsOf(await anon.from("templates").select("id")), "templates: anonymous can read").toHaveLength(0);
    for (const client of [A.client, E.client, anon]) {
      const upd = await client.from("templates").update({ tier: "free" }).eq("id", template2).select();
      const del = await client.from("templates").delete().eq("id", template2).select();
      const ins = await client.from("templates").insert({ name: "Injected", tier: "free" }).select();
      expect(wasBlocked(upd) && wasBlocked(del) && wasBlocked(ins), "templates: client can write").toBe(true);
    }
    const { data } = await admin.from("templates").select("tier").eq("id", template2).single();
    expect(data?.tier, "templates: tier was changed by a client").toBe("pro");
  });

  it("system question flows are readable by any signed-in user but not anonymous", async () => {
    await must(
      admin.from("question_flows").insert({ workspace_id: null, type: "agency", name: "System flow", questions: [] }).select(),
      "system flow",
    );
    for (const user of [A, B]) {
      const res = await user.client.from("question_flows").select("name").eq("name", "System flow");
      expect(rowsOf(res), "question_flows: signed-in user cannot read system flow").toHaveLength(1);
    }
    expect(rowsOf(await anon.from("question_flows").select("name")), "question_flows: anonymous can read").toHaveLength(0);
    const write = await A.client.from("question_flows").update({ name: "HACKED" }).is("workspace_id", null).select();
    expect(wasBlocked(write), "question_flows: client can edit system flows").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Roles and membership rules
// ---------------------------------------------------------------------------

describe("workspace roles", () => {
  it("nobody can change a workspace plan from the client", async () => {
    for (const user of [A, E]) {
      const res = await user.client.from("workspaces").update({ plan: "team" }).eq("id", tenantA.ws).select();
      expect(res.error, "workspaces: plan is client-writable").not.toBeNull();
    }
    const { data } = await admin.from("workspaces").select("plan").eq("id", tenantA.ws).single();
    expect(data?.plan, "workspaces: plan changed").toBe("free");
  });

  it("admin can edit settings; editor and viewer cannot", async () => {
    const asAdmin = await E.client.from("workspaces").update({ name: "Isolation A (renamed)" }).eq("id", tenantA.ws).select();
    expect(rowsOf(asAdmin), "workspaces: admin cannot update").toHaveLength(1);
    for (const user of [D, C]) {
      const res = await user.client.from("workspaces").update({ name: "HACKED" }).eq("id", tenantA.ws).select();
      expect(wasBlocked(res), "workspaces: editor/viewer can update").toBe(true);
    }
  });

  it("nobody can delete a workspace directly: deletion goes through the 30 day grace period", async () => {
    for (const [who, user] of [["admin", E], ["owner", A]] as const) {
      const res = await user.client.from("workspaces").delete().eq("id", tenantA.ws).select();
      expect(wasBlocked(res), `workspaces: ${who} deleted a workspace directly`).toBe(true);
    }
    const { data } = await admin.from("workspaces").select("id").eq("id", tenantA.ws);
    expect(data).toHaveLength(1);
  });

  it("nobody can add members directly: not owner, admin, editor or viewer", async () => {
    for (const user of [A, E, D, C]) {
      const res = await user.client.from("workspace_members").insert({ workspace_id: tenantA.ws, user_id: F.id, role: "viewer" }).select();
      expect(wasBlocked(res), "workspace_members: direct insert is possible").toBe(true);
    }
    const { data } = await admin.from("workspace_members").select("user_id").eq("workspace_id", tenantA.ws).eq("user_id", F.id);
    expect(data).toHaveLength(0);
  });

  it("an admin cannot demote or remove an owner, or promote anyone to owner", async () => {
    const demote = await E.client.from("workspace_members").update({ role: "viewer" }).eq("workspace_id", tenantA.ws).eq("user_id", A.id).select();
    expect(wasBlocked(demote), "workspace_members: admin demoted an owner").toBe(true);
    const remove = await E.client.from("workspace_members").delete().eq("workspace_id", tenantA.ws).eq("user_id", A.id).select();
    expect(wasBlocked(remove), "workspace_members: admin removed an owner").toBe(true);
    const promote = await E.client.from("workspace_members").update({ role: "owner" }).eq("workspace_id", tenantA.ws).eq("user_id", D.id).select();
    expect(wasBlocked(promote), "workspace_members: admin promoted someone to owner").toBe(true);
    const { data } = await admin.from("workspace_members").select("role").eq("workspace_id", tenantA.ws).eq("user_id", A.id).single();
    expect(data?.role).toBe("owner");
  });

  it("nobody can change their own role", async () => {
    for (const user of [A, E, D]) {
      const res = await user.client.from("workspace_members").update({ role: "owner" }).eq("workspace_id", tenantA.ws).eq("user_id", user.id).select();
      expect(wasBlocked(res), "workspace_members: user changed their own role").toBe(true);
    }
  });

  it("an admin can change another member's role through change_member_role (positive control)", async () => {
    const res = await E.client.rpc("change_member_role", { ws: tenantA.ws, member: D.id, new_role: "viewer" });
    expect(res.error, "change_member_role: admin cannot change a role").toBeNull();
    const { data } = await admin.from("workspace_members").select("role").eq("workspace_id", tenantA.ws).eq("user_id", D.id).single();
    expect(data?.role).toBe("viewer");
    await admin.from("workspace_members").update({ role: "editor" }).eq("workspace_id", tenantA.ws).eq("user_id", D.id);
  });

  it("the last owner cannot leave", async () => {
    const res = await A.client.from("workspace_members").delete().eq("workspace_id", tenantA.ws).eq("user_id", A.id).select();
    expect(wasBlocked(res), "workspace_members: last owner removed themselves").toBe(true);
    const { data } = await admin.from("workspace_members").select("user_id").eq("workspace_id", tenantA.ws).eq("role", "owner");
    expect(data, "workspace_members: workspace left without an owner").toHaveLength(1);
  });

  it("create_workspace: needs a session, validates input, and is capped per user", async () => {
    const anonymous = await anon.rpc("create_workspace", { name: "Anon", type: "agency" });
    expect(anonymous.error, "create_workspace: callable anonymously").not.toBeNull();

    const emptyName = await F.client.rpc("create_workspace", { name: "   ", type: "agency" });
    expect(emptyName.error, "create_workspace: accepts an empty name").not.toBeNull();
    const badType = await F.client.rpc("create_workspace", { name: "X", type: "enterprise" });
    expect(badType.error, "create_workspace: accepts an unknown type").not.toBeNull();

    for (let i = 1; i <= 5; i++) await newWorkspace(F, `Cap ${i}`);
    const sixth = await F.client.rpc("create_workspace", { name: "Cap 6", type: "agency" });
    expect(sixth.error, "create_workspace: no cap on owned workspaces").not.toBeNull();
  });

  it("helper functions are not callable anonymously", async () => {
    for (const [fn, args] of [
      ["is_member", { ws: tenantA.ws }],
      ["write_audit_log", { ws: tenantA.ws, action: "anon.event" }],
    ] as const) {
      const res = await anon.rpc(fn, args);
      expect(res.error, `${fn}: callable anonymously`).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Case study state, claims, audit log
// ---------------------------------------------------------------------------

describe("case study integrity", () => {
  let draftId: string;

  beforeAll(async () => {
    // Case studies are created by the server (create_generated_case_study); no client can insert one.
    const draft = await admin
      .from("case_studies")
      .insert({ workspace_id: tenantA.ws, interview_id: tenantA.interviewId, content: {}, slug: slug() })
      .select()
      .single();
    draftId = String(draft.data?.id);
  });

  it("nobody can create a case study, version or claim directly, whatever the status or role", async () => {
    for (const [who, user] of [["owner", A], ["admin", E], ["editor", D]] as const) {
      for (const status of ["draft", "approved", "published"]) {
        const res = await user.client.from("case_studies").insert({ workspace_id: tenantA.ws, content: {}, slug: slug(), status }).select();
        expect(wasBlocked(res), `case_studies: ${who} inserted a ${status} case study directly`).toBe(true);
      }
      const version = await user.client.from("case_study_versions").insert({ case_study_id: tenantA.caseStudyId, workspace_id: tenantA.ws, version: 50, content: {}, created_by: user.id }).select();
      expect(wasBlocked(version), `case_study_versions: ${who} appended a version directly`).toBe(true);
      const claim = await user.client.from("claims").insert({ case_study_id: tenantA.caseStudyId, workspace_id: tenantA.ws, text: "x", source_message_id: tenantA.messageId, source_quote: CLIENT_QUOTE }).select();
      expect(wasBlocked(claim), `claims: ${who} inserted a claim directly`).toBe(true);
    }
  });

  it("nobody can write a case study's status or slug directly; transitions use the approval and publish functions", async () => {
    for (const [who, user] of [["editor", D], ["admin", E], ["owner", A]] as const) {
      for (const status of ["draft", "awaiting_client_approval", "approved", "published", "unpublished"]) {
        const res = await user.client.from("case_studies").update({ status }).eq("id", draftId).select();
        expect(wasBlocked(res), `case_studies: ${who} set status to ${status} directly`).toBe(true);
      }
      expect(wasBlocked(await user.client.from("case_studies").update({ slug: slug() }).eq("id", draftId).select()), `case_studies: ${who} set slug directly`).toBe(true);
    }
  });

  it("the database rejects a claim without a verbatim client quote, for every role including the server", async () => {
    const base = { case_study_id: tenantA.caseStudyId, workspace_id: tenantA.ws, text: "Costs fell", source_message_id: tenantA.messageId };
    const invented = await admin.from("claims").insert({ ...base, source_quote: "cut costs by 90 percent" }).select();
    expect(invented.error, "claims: an invented number was accepted").not.toBeNull();
    const valid = await admin.from("claims").insert({ ...base, source_quote: CLIENT_QUOTE }).select();
    expect(rowsOf(valid), "claims: valid claim rejected").toHaveLength(1);
  });

  it("an editor cannot confirm a claim on the client's behalf", async () => {
    const res = await D.client.from("claims").update({ client_confirmed: true }).eq("case_study_id", tenantA.caseStudyId).select();
    expect(wasBlocked(res), "claims: editor set client_confirmed").toBe(true);
  });
});

describe("audit log", () => {
  it("only editor+ can write through write_audit_log, only known UI actions, and always as themselves", async () => {
    const viewer = await C.client.rpc("write_audit_log", { ws: tenantA.ws, action: "case_study.template" });
    expect(viewer.error, "audit_log: viewer can write").not.toBeNull();

    const bad = await D.client.rpc("write_audit_log", { ws: tenantA.ws, action: "Bad Action!" });
    expect(bad.error, "audit_log: free-form action accepted").not.toBeNull();

    const outsider = await B.client.rpc("write_audit_log", { ws: tenantA.ws, action: "case_study.template" });
    expect(outsider.error, "audit_log: another tenant can write").not.toBeNull();

    // An editor must not be able to fabricate security-relevant history.
    for (const action of ["token.revoke", "member.remove", "member.role_change", "invite.accept", "case_study.publish", "interview.complete"]) {
      const forged = await D.client.rpc("write_audit_log", { ws: tenantA.ws, action, target: "x" });
      expect(forged.error, `audit_log: editor forged ${action}`).not.toBeNull();
    }

    const ok = await D.client.rpc("write_audit_log", { ws: tenantA.ws, action: "case_study.template", target: "request" });
    expect(ok.error, "audit_log: editor cannot write").toBeNull();
    const { data } = await admin.from("audit_log").select("actor").eq("workspace_id", tenantA.ws).eq("action", "case_study.template");
    expect(data?.[0]?.actor, "audit_log: actor was not the caller").toBe(D.id);
  });
});

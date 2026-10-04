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
  await admin.from("question_flows").delete().is("workspace_id", null);
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
  readRole: "viewer" | "admin";
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

  it("only an owner can delete a workspace", async () => {
    const res = await E.client.from("workspaces").delete().eq("id", tenantA.ws).select();
    expect(wasBlocked(res), "workspaces: admin can delete").toBe(true);
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

  it("an editor can create a draft but not an approved or published case study", async () => {
    const draft = await D.client
      .from("case_studies")
      .insert({ workspace_id: tenantA.ws, interview_id: tenantA.interviewId, content: {}, slug: slug() })
      .select()
      .single();
    expect(draft.error, "case_studies: editor cannot create a draft").toBeNull();
    draftId = String(draft.data?.id);

    for (const status of ["approved", "published"]) {
      const res = await D.client
        .from("case_studies")
        .insert({ workspace_id: tenantA.ws, content: {}, slug: slug(), status })
        .select();
      expect(wasBlocked(res), `case_studies: editor created a ${status} case study`).toBe(true);
    }
  });

  it("an editor cannot forge approval or publication; asking for approval is fine", async () => {
    for (const status of ["approved", "published"]) {
      const res = await D.client.from("case_studies").update({ status }).eq("id", draftId).select();
      expect(wasBlocked(res), `case_studies: editor set status to ${status}`).toBe(true);
    }
    const ok = await D.client.from("case_studies").update({ status: "awaiting_client_approval" }).eq("id", draftId).select();
    expect(rowsOf(ok), "case_studies: editor cannot request approval").toHaveLength(1);
  });

  it("an admin cannot publish from the client either (database trigger lands in Phase 6.2)", async () => {
    const res = await E.client.from("case_studies").update({ status: "published" }).eq("id", draftId).select();
    expect(wasBlocked(res), "case_studies: admin published without the Phase 6.2 guard").toBe(true);
  });

  it("a claim needs a verbatim client quote and cannot be pre-confirmed", async () => {
    const base = { case_study_id: tenantA.caseStudyId, workspace_id: tenantA.ws, text: "Costs fell", source_message_id: tenantA.messageId };
    const invented = await D.client.from("claims").insert({ ...base, source_quote: "cut costs by 90 percent" }).select();
    expect(invented.error, "claims: an invented number was accepted").not.toBeNull();
    const confirmed = await D.client.from("claims").insert({ ...base, source_quote: CLIENT_QUOTE, client_confirmed: true }).select();
    expect(wasBlocked(confirmed), "claims: editor created a pre-confirmed claim").toBe(true);
    const valid = await D.client.from("claims").insert({ ...base, source_quote: CLIENT_QUOTE }).select();
    expect(rowsOf(valid), "claims: valid claim rejected").toHaveLength(1);
  });

  it("an editor cannot confirm a claim on the client's behalf", async () => {
    const res = await D.client.from("claims").update({ client_confirmed: true }).eq("case_study_id", tenantA.caseStudyId).select();
    expect(wasBlocked(res), "claims: editor set client_confirmed").toBe(true);
  });

  it("versions: an editor can append one as themselves, not as someone else", async () => {
    const own = await D.client
      .from("case_study_versions")
      .insert({ case_study_id: tenantA.caseStudyId, workspace_id: tenantA.ws, version: 3, content: {}, created_by: D.id })
      .select();
    expect(rowsOf(own), "case_study_versions: editor cannot append").toHaveLength(1);
    const forged = await D.client
      .from("case_study_versions")
      .insert({ case_study_id: tenantA.caseStudyId, workspace_id: tenantA.ws, version: 4, content: {}, created_by: A.id })
      .select();
    expect(wasBlocked(forged), "case_study_versions: editor forged created_by").toBe(true);
  });
});

describe("audit log", () => {
  it("only editor+ can write through write_audit_log, and always as themselves", async () => {
    const viewer = await C.client.rpc("write_audit_log", { ws: tenantA.ws, action: "viewer.spam" });
    expect(viewer.error, "audit_log: viewer can write").not.toBeNull();

    const bad = await D.client.rpc("write_audit_log", { ws: tenantA.ws, action: "Bad Action!" });
    expect(bad.error, "audit_log: free-form action accepted").not.toBeNull();

    const outsider = await B.client.rpc("write_audit_log", { ws: tenantA.ws, action: "outsider.spam" });
    expect(outsider.error, "audit_log: another tenant can write").not.toBeNull();

    const ok = await D.client.rpc("write_audit_log", { ws: tenantA.ws, action: "token.revoke", target: "request" });
    expect(ok.error, "audit_log: editor cannot write").toBeNull();
    const { data } = await admin.from("audit_log").select("actor").eq("workspace_id", tenantA.ws).eq("action", "token.revoke");
    expect(data?.[0]?.actor, "audit_log: actor was not the caller").toBe(D.id);
  });
});

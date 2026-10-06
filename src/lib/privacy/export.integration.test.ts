/** The owner's data export against the real database (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, hex64, loadLocalConfig, makeClient, type TestUser } from "../../../supabase/tests/isolation/harness";
import { readZip } from "@/test/zip-reader";
import { generateToken } from "@/lib/security/tokens";
import { buildExport, EXPORT_SOURCES } from "./export";

let admin: SupabaseClient;
let a: TestUser;
let b: TestUser;
let editor: TestUser;
let wsA: string;
let wsB: string;

async function seed(user: TestUser, ws: string, label: string) {
  const { data: requestId } = await user.client.rpc("create_proof_request", { ws, client_name: `${label} CLIENT NAME`, client_email: `${label}-client@example.test`, project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: generateToken().hash });
  const { data: interview } = await admin.from("interviews").insert({ request_id: requestId, workspace_id: ws, status: "completed", consent_given: true, consent_text_version: "v1", question_index: 6, publish_permission: "first_name" }).select("id").single();
  await admin.from("interview_messages").insert({ interview_id: interview?.id, workspace_id: ws, role: "client", content: `${label} TRANSCRIPT` });
  const content = { headline: `${label} HEADLINE`, client: {}, sections: [{ type: "challenge", title: "The challenge", body: "Body" }], tags: [] };
  const { data: cs } = await admin.from("case_studies").insert({ workspace_id: ws, interview_id: interview?.id, content, status: "draft" }).select("id").single();
  await admin.from("case_study_versions").insert({ case_study_id: cs?.id, workspace_id: ws, version: 1, content });
  await admin.from("referrals").insert({ workspace_id: ws, interview_id: interview?.id, referred_name: `${label} REFERRAL`, referred_contact: `${label}-ref@example.test` });
  await admin.from("subscriptions").upsert({ workspace_id: ws, stripe_customer_id: `cus_${hex64().slice(0, 12)}`, plan: "pro", status: "active" });
}

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  [a, b, editor] = await Promise.all(["ex-a", "ex-b", "ex-editor"].map((l) => createTestUser(cfg, admin, l)));
  wsA = String((await a.client.rpc("create_workspace", { name: "Export A", type: "agency" })).data);
  wsB = String((await b.client.rpc("create_workspace", { name: "Export B", type: "agency" })).data);
  await admin.from("workspaces").update({ plan: "pro" }).in("id", [wsA, wsB]);
  await admin.from("workspace_members").insert({ workspace_id: wsA, user_id: editor.id, role: "editor" });
  await seed(a, wsA, "ALPHA");
  await seed(b, wsB, "BRAVO");
}, 120_000);

afterAll(async () => {
  for (const ws of [wsA, wsB]) {
    await admin.from("workspaces").update({ deletion_requested_at: new Date(Date.now() - 40 * 86_400_000).toISOString() }).eq("id", ws);
    await admin.rpc("hard_delete_workspace", { ws });
  }
  for (const u of [a, b, editor]) await admin.auth.admin.deleteUser(u.id);
}, 120_000);

describe("buildExport", () => {
  it("contains the owner's own records in readable JSON, and none of another workspace's", async () => {
    const { zip, counts } = await buildExport(a.client, wsA);
    const files = readZip(zip);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["README.txt", "manifest.json", "team.json", ...EXPORT_SOURCES.map((s) => s.file)]));
    const text = (name: string) => files[name].toString("utf8");
    expect(text("proof_requests.json")).toContain("ALPHA CLIENT NAME");
    expect(text("proof_requests.json")).toContain("ALPHA-client@example.test");
    expect(text("interview_messages.json")).toContain("ALPHA TRANSCRIPT");
    expect(text("case_studies.json")).toContain("ALPHA HEADLINE");
    expect(text("referrals.json")).toContain("ALPHA REFERRAL");
    expect(text("team.json")).toContain(a.email.toLowerCase());
    expect(counts["proof_requests.json"]).toBe(1);
    expect(JSON.parse(text("manifest.json")).workspaceId).toBe(wsA);

    for (const [name, data] of Object.entries(files)) {
      expect(data.toString("utf8"), `${name} contains another workspace's data`).not.toContain("BRAVO");
      expect(data.toString("utf8"), `${name} names another workspace`).not.toContain(wsB);
      JSON.parse(name.endsWith(".json") ? data.toString("utf8") : "{}");
    }
  });

  it("never includes secrets: token hashes, push keys or Stripe identifiers", async () => {
    const files = readZip((await buildExport(a.client, wsA)).zip);
    const everything = Object.entries(files).filter(([name]) => name.endsWith(".json")).map(([, f]) => f.toString("utf8")).join("\n");
    for (const forbidden of ["token_hash", "p256dh", "stripe_customer_id", "stripe_subscription_id", "ip_hash", "password"]) {
      expect(everything.includes(forbidden), `the export contains "${forbidden}"`).toBe(false);
    }
    expect(everything).not.toMatch(/\bcus_[A-Za-z0-9]{8,}|\bsub_[A-Za-z0-9]{8,}/);
    expect(JSON.parse(files["subscription.json"].toString("utf8"))).toEqual([expect.objectContaining({ plan: "pro", status: "active" })]);
  });

  it("only ever reads what the caller's own client may read (a non-owner member gets only what RLS shows them, an outsider nothing)", async () => {
    const outsider = await buildExport(b.client, wsA);
    const outsiderFiles = readZip(outsider.zip);
    for (const [name, data] of Object.entries(outsiderFiles)) {
      if (name.endsWith(".json") && name !== "manifest.json") expect(JSON.parse(data.toString("utf8")), `${name} leaked to an outsider`).toEqual([]);
    }
    expect(outsiderFiles["README.txt"]).toBeDefined();

    const member = readZip((await buildExport(editor.client, wsA)).zip);
    const text = Buffer.concat(Object.values(member)).toString("utf8");
    expect(text).not.toContain("BRAVO");
    // An editor cannot read audit or approval records, so the export has none of them (the route is owner only anyway).
    expect(JSON.parse(member["audit_log.json"].toString("utf8"))).toEqual([]);
  });
});

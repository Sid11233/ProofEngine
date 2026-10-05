/**
 * Regression tests for the security audit findings, through the real REST API.
 * (Catalog-level guardrails live in supabase/tests/database/03_security_catalog.test.sql.)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, hex64, loadLocalConfig, makeClient, type LocalConfig, type TestUser } from "./harness";

let cfg: LocalConfig;
let admin: SupabaseClient;
let owner: TestUser;
let ws: string;
const users: string[] = [];

const request = async () =>
  String(
    (
      await admin
        .from("proof_requests")
        .insert({ workspace_id: ws, client_name: "C", client_email: "c@example.test", flow_type: "agency", token_hash: hex64(), expires_at: new Date(Date.now() + 86_400_000).toISOString() })
        .select("id")
        .single()
    ).data?.id,
  );

async function interviewWithMessage(content: string) {
  const { data: interview } = await admin.from("interviews").insert({ request_id: await request(), workspace_id: ws, status: "completed", consent_given: true }).select("id").single();
  const { data: message } = await admin.from("interview_messages").insert({ interview_id: interview?.id, workspace_id: ws, role: "client", content }).select("id").single();
  return { interviewId: String(interview?.id), messageId: String(message?.id) };
}

beforeAll(async () => {
  cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  owner = await createTestUser(cfg, admin, "hard-owner");
  users.push(owner.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Hardening Co", type: "agency" })).data);
}, 60_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  for (const id of users) await admin.auth.admin.deleteUser(id);
});

describe("claims stay with their own interview", () => {
  it("a claim cannot quote a different client's interview, even for the server role", async () => {
    const a = await interviewWithMessage("Client A said we cut costs by 40 percent.");
    const b = await interviewWithMessage("Client B said we tripled revenue overnight.");
    const { data: study } = await admin.from("case_studies").insert({ workspace_id: ws, interview_id: a.interviewId, content: {} }).select("id").single();

    const foreign = await admin.from("claims").insert({ case_study_id: study?.id, workspace_id: ws, text: "x", source_message_id: b.messageId, source_quote: "tripled revenue overnight" }).select();
    expect(foreign.error, "a quote from another interview was accepted").not.toBeNull();
    expect(foreign.error?.code).toBe("23514");

    const own = await admin.from("claims").insert({ case_study_id: study?.id, workspace_id: ws, text: "x", source_message_id: a.messageId, source_quote: "cut costs by 40 percent" }).select();
    expect(own.error).toBeNull();
  });

  it("a case study with no interview can have no claims at all", async () => {
    const a = await interviewWithMessage("We cut costs by 40 percent.");
    const { data: orphan } = await admin.from("case_studies").insert({ workspace_id: ws, content: {} }).select("id").single();
    const res = await admin.from("claims").insert({ case_study_id: orphan?.id, workspace_id: ws, text: "x", source_message_id: a.messageId, source_quote: "cut costs by 40 percent" }).select();
    expect(res.error).not.toBeNull();
  });
});

describe("the REST surface as PostgREST publishes it", () => {
  const openApi = async (token: string) => {
    const res = await fetch(`${cfg.url}/rest/v1/`, { headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}`, accept: "application/openapi+json" } });
    const spec = (await res.json()) as { paths?: Record<string, unknown> };
    return Object.keys(spec.paths ?? {});
  };

  it("shows an anonymous caller only the public view: no tables, no functions", async () => {
    const paths = await openApi(cfg.anonKey);
    expect(paths.filter((p) => p !== "/").sort(), `anonymous callers can see: ${paths.join(", ")}`).toEqual(["/public_case_studies", "/public_wall_settings"]);
  });

  it("shows a signed-in user only the reviewed functions, and none of the server-only ones", async () => {
    const session = await owner.client.auth.getSession();
    const paths = await openApi(String(session.data.session?.access_token));
    const functions = paths.filter((p) => p.startsWith("/rpc/")).map((p) => p.slice(5)).sort();
    expect(functions).toEqual(
      [
        "accept_invite", "autosave_case_study", "bump_ai_usage", "change_member_role", "create_generated_case_study",
        "create_invite", "create_preview_link", "create_proof_request", "create_workspace", "get_invite_preview",
        "is_member", "is_reserved_slug", "list_team_members", "plan_interview_limit", "publish_case_study", "remove_member", "request_client_approval", "revoke_invite",
        "revoke_preview_link", "revoke_request", "role_rank", "rotate_request_token", "save_case_study_edit", "save_wall_settings",
        "snapshot_case_study", "template_allowed", "unpublish_case_study", "write_audit_log",
      ].sort(),
    );
    for (const serverOnly of ["start_interview", "record_client_message", "record_bot_message", "finish_interview", "record_upload", "check_ai_breaker", "audit", "approve_case_study", "request_case_study_changes", "decline_case_study", "lock_approval", "create_takedown_request", "set_case_study_disabled", "resolve_takedown", "record_page_event", "auto_remind_candidates", "auto_remind_request", "auto_remind_revert", "mark_do_not_contact", "reminder_due", "workspace_reminders_today"]) {
      expect(functions).not.toContain(serverOnly);
    }
  });
});

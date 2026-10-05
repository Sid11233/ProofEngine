/** Page events and dashboard views against the real database (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, hex64, loadLocalConfig, makeClient, rowsOf, wasBlocked, type TestUser } from "../../../supabase/tests/isolation/harness";
import { generateToken } from "@/lib/security/tokens";
import { recordPageEvent } from "./record";

let admin: SupabaseClient;
let anon: SupabaseClient;
let a: TestUser;
let b: TestUser;
let wsA: string;
let wsB: string;
let slugA: string;
let pageSlugA: string;
let idA: string;
let idB: string;

const content = (h: string) => ({ headline: h, client: {}, sections: [{ type: "challenge", title: "The challenge", body: "Body" }], tags: [] });

async function published(user: TestUser, ws: string, headline: string) {
  const slug = `an-${hex64().slice(0, 8)}`;
  const { data: requestId } = await user.client.rpc("create_proof_request", { ws, client_name: "Dana Doe", client_email: "dana@example.test", project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: generateToken().hash });
  const { data: interview } = await admin.from("interviews").insert({ request_id: requestId, workspace_id: ws, status: "completed", consent_given: true, consent_text_version: "v1", question_index: 6, publish_permission: "first_name" }).select("id").single();
  const { data: cs } = await admin.from("case_studies").insert({ workspace_id: ws, interview_id: interview?.id, content: content(headline), status: "draft" }).select("id").single();
  const id = String(cs?.id);
  await admin.from("case_study_versions").insert({ case_study_id: id, workspace_id: ws, version: 1, content: content(headline) });
  const token = generateToken();
  await user.client.rpc("request_client_approval", { study: id, hash: token.hash });
  await admin.rpc("approve_case_study", { token_hash: token.hash, ip_hash: hex64() });
  expect((await user.client.rpc("publish_case_study", { study: id, new_slug: slug })).error).toBeNull();
  return { id, slug };
}

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  anon = makeClient(cfg, "anon");
  [a, b] = await Promise.all(["an-a", "an-b"].map((l) => createTestUser(cfg, admin, l)));
  wsA = String((await a.client.rpc("create_workspace", { name: "Analytics A", type: "agency" })).data);
  wsB = String((await b.client.rpc("create_workspace", { name: "Analytics B", type: "agency" })).data);
  const sA = `an-${hex64().slice(0, 8)}`;
  const sB = `an-${hex64().slice(0, 8)}`;
  await admin.from("workspaces").update({ plan: "pro", subdomain_slug: sA }).eq("id", wsA);
  await admin.from("workspaces").update({ plan: "pro", subdomain_slug: sB }).eq("id", wsB);
  const pa = await published(a, wsA, "Story A");
  const pb = await published(b, wsB, "Story B");
  slugA = sA;
  idA = pa.id;
  idB = pb.id;
  pageSlugA = pa.slug;
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", wsA);
  await admin.from("workspaces").delete().eq("id", wsB);
  for (const u of [a, b]) await admin.auth.admin.deleteUser(u.id);
}, 120_000);

const pageA = () => pageSlugA;

describe("record_page_event", () => {
  it("stores only type, page, hostname-only referrer and time", async () => {
    expect(await recordPageEvent(admin, slugA, pageA(), { type: "view", referrer: "https://News.Example.com/a/b?token=secret" })).toBe(true);
    expect(await recordPageEvent(admin, slugA, pageA(), { type: "cta_click", referrer: "https://ignored.example" })).toBe(true);
    const { data } = await admin.from("page_events").select("*").eq("case_study_id", idA).order("created_at");
    expect(data?.map((r) => ({ type: r.type, referrer: r.referrer }))).toEqual([{ type: "view", referrer: "news.example.com" }, { type: "cta_click", referrer: null }]);
    // There is simply no column that could hold an address, a browser string or a visitor id.
    expect(Object.keys(data?.[0] ?? {}).sort()).toEqual(["case_study_id", "created_at", "id", "referrer", "type", "workspace_id"]);
  });

  it("ignores pages that are not public and rejects unknown event types", async () => {
    expect(await recordPageEvent(admin, slugA, "no-such-page", { type: "view" })).toBe(false);
    expect(await recordPageEvent(admin, `other-${slugA}`, pageA(), { type: "view" }), "a page under another workspace's address").toBe(false);
    expect((await admin.rpc("record_page_event", { ws_slug: slugA, study_slug: pageA(), event_type: "purchase", ref_host: null })).error).not.toBeNull();
  });

  it("is writable by the server only, and events can never be changed", async () => {
    const args = { ws_slug: slugA, study_slug: pageA(), event_type: "view", ref_host: null };
    expect(wasBlocked(await anon.rpc("record_page_event", args))).toBe(true);
    expect(wasBlocked(await a.client.rpc("record_page_event", args))).toBe(true);
    expect(wasBlocked(await a.client.from("page_events").insert({ case_study_id: idA, workspace_id: wsA, type: "view" }).select())).toBe(true);
    expect((await admin.from("page_events").update({ type: "cta_click" }).eq("case_study_id", idA)).error).not.toBeNull();
    expect((await admin.from("page_events").delete().eq("case_study_id", idA)).error).not.toBeNull();
  });
});

describe("dashboard views", () => {
  it("each workspace sees only its own numbers, through its own client", async () => {
    await admin.from("page_events").insert([{ case_study_id: idB, workspace_id: wsB, type: "view" }, { case_study_id: idB, workspace_id: wsB, type: "view" }]);

    const daily = rowsOf(await a.client.from("page_event_daily").select("workspace_id, type, events"));
    expect(daily.every((r) => r.workspace_id === wsA)).toBe(true);
    expect(daily.reduce((n, r) => n + Number(r.events), 0)).toBe(2);
    const dailyB = rowsOf(await b.client.from("page_event_daily").select("workspace_id, type, events"));
    expect(dailyB.every((r) => r.workspace_id === wsB)).toBe(true);
    expect(dailyB.reduce((n, r) => n + Number(r.events), 0)).toBe(2);

    for (const view of ["case_study_status_counts", "referral_status_counts", "request_funnel"]) {
      for (const [user, ws] of [[a, wsA], [b, wsB]] as const) {
        const rows = rowsOf(await user.client.from(view).select("*"));
        expect(rows.every((r) => r.workspace_id === ws), `${view} leaked another workspace`).toBe(true);
      }
    }
    expect(rowsOf(await anon.from("page_event_daily").select("*"))).toHaveLength(0);
  });

  it("counts statuses and the request funnel correctly", async () => {
    const statuses = rowsOf(await a.client.from("case_study_status_counts").select("status, n"));
    expect(statuses).toEqual([{ status: "published", n: 1 }]);
    const funnel = rowsOf(await a.client.from("request_funnel").select("sent, started, completed"));
    expect(funnel).toEqual([{ sent: 0, started: 1, completed: 1 }]);
  });
});

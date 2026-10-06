import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { BASE, createUser, newPage, signIn, startStack, stopStack, type Stack } from "./harness";

// Pre-launch checklist: "Sign up as two accounts and try to access each other's data through the UI and the API".

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 120_000);
afterAll(async () => {
  await stopStack(stack);
});

async function tenant(label: string) {
  const user = await createUser(stack.admin, label);
  const { data: m } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", user.id).single();
  const ws = String(m?.workspace_id);
  await stack.admin.from("workspaces").update({ plan: "pro", subdomain_slug: `ct-${randomBytes(4).toString("hex")}` }).eq("id", ws);

  const { data: request } = await stack.admin.from("proof_requests").insert({ workspace_id: ws, client_name: `${label} SECRET CLIENT`, client_email: `${label}@secret.test`, flow_type: "agency", token_hash: randomBytes(32).toString("hex"), expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: "completed" }).select("id").single();
  const { data: interview } = await stack.admin.from("interviews").insert({ request_id: request?.id, workspace_id: ws, status: "completed", consent_given: true, consent_text_version: "v1", question_index: 6, publish_permission: "first_name" }).select("id").single();
  const { data: message } = await stack.admin.from("interview_messages").insert({ interview_id: interview?.id, workspace_id: ws, role: "client", content: `${label} SECRET TRANSCRIPT cut costs by 40 percent` }).select("id").single();
  const content = { headline: `${label} SECRET HEADLINE`, client: {}, sections: [{ type: "challenge", title: "Challenge", body: "Body" }], tags: [] };
  const { data: study } = await stack.admin.from("case_studies").insert({ workspace_id: ws, interview_id: interview?.id, content, status: "draft" }).select("id").single();
  const studyId = String(study?.id);
  await stack.admin.from("case_study_versions").insert({ case_study_id: studyId, workspace_id: ws, version: 1, content });
  await stack.admin.from("claims").insert({ case_study_id: studyId, workspace_id: ws, text: "Costs fell", source_message_id: message?.id, source_quote: "cut costs by 40 percent" });
  await stack.admin.from("referrals").insert({ workspace_id: ws, referred_name: `${label} SECRET REFERRAL`, referred_contact: `${label}-ref@secret.test` });
  await stack.admin.from("workspace_communities").insert({ workspace_id: ws, community_id: "b0000000-0000-4000-8000-000000000001", status: "saved", notes: `${label} SECRET NOTE` });
  const raw = randomBytes(32).toString("base64url");
  await stack.admin.from("case_study_previews").insert({ case_study_id: studyId, workspace_id: ws, token_hash: createHash("sha256").update(raw).digest("hex"), expires_at: new Date(Date.now() + 86_400_000).toISOString() });

  const api = createClient(stack.cfg.url, stack.cfg.anonKey, { auth: { persistSession: false } });
  await api.auth.signInWithPassword({ email: user.email, password: user.password });
  return { ...user, ws, requestId: String(request?.id), interviewId: String(interview?.id), studyId, api, label };
}

describe("two accounts, UI and API", () => {
  it("A's data is invisible and untouchable for B, through pages, routes and the REST API", async () => {
    const A = await tenant("alice");
    const B = await tenant("bob");

    // UI: B opens A's ids.
    const page = await newPage(stack);
    await signIn(page, B.email, B.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    for (const path of [`/app/case-studies/${A.studyId}/edit`, `/app/case-studies/${A.studyId}/review`, `/app/case-studies/${A.studyId}/template`, `/app/requests/${A.requestId}`]) {
      const res = await page.goto(`${BASE}${path}`);
      expect(res?.status(), path).toBe(404);
      expect(await page.locator("body").innerText(), path).not.toContain("alice");
    }
    // B's own pages show B's data and none of A's.
    for (const path of ["/app/requests", "/app/case-studies", "/app/referrals", "/app/finder", "/app/dashboard"]) {
      await page.goto(`${BASE}${path}`);
      const text = await page.locator("body").innerText();
      expect(text, path).not.toMatch(/alice/i);
    }
    await page.goto(`${BASE}/app/referrals`);
    await page.getByText("bob SECRET REFERRAL").waitFor();

    // Route handlers with B's cookie: A's ids give nothing.
    const cookies = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
    const post = (path: string, body: unknown) => fetch(`${BASE}${path}`, { method: "POST", headers: { cookie: cookies, origin: BASE, "content-type": "application/json", "x-forwarded-for": `198.51.100.${(Date.now() % 200) + 1}` }, body: JSON.stringify(body) });
    const gen = await post("/api/case-studies/generate", { interviewId: A.interviewId });
    expect([403, 404, 400, 503], "B generated from A interview").toContain(gen.status); // 503 = AI not configured in this stack; the interview check itself is covered by generator.integration.test
    expect(await gen.text()).not.toContain("alice");
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "x.png");
    const logo = await fetch(`${BASE}/api/case-studies/${A.studyId}/logo`, { method: "POST", headers: { cookie: cookies, origin: BASE, "x-forwarded-for": "198.51.100.77" }, body: form });
    expect([403, 404, 400, 422], "B uploaded a logo to A's study").toContain(logo.status);

    // REST API with B's token: reads empty, writes refused or no-ops, and A's rows are unchanged.
    for (const table of ["case_studies", "case_study_versions", "claims", "proof_requests_safe", "interviews", "interview_messages", "referrals", "workspace_communities", "case_study_previews", "approvals", "audit_log", "subscriptions", "usage_counters"]) {
      const { data } = await B.api.from(table).select("*").eq("workspace_id", A.ws);
      expect(data ?? [], `B read A's ${table}`).toHaveLength(0);
    }
    for (const rpc of [
      ["publish_case_study", { study: A.studyId, new_slug: "stolen" }],
      ["unpublish_case_study", { study: A.studyId }],
      ["request_client_approval", { study: A.studyId, hash: randomBytes(32).toString("hex") }],
      ["create_preview_link", { study: A.studyId, hash: randomBytes(32).toString("hex") }],
      ["save_case_study_edit", { study: A.studyId, new_content: { headline: "pwned", client: {}, sections: [], tags: [] }, edited_claims: [] }],
      ["autosave_case_study", { study: A.studyId, new_content: { headline: "pwned", client: {}, sections: [], tags: [] }, edited_claims: [] }],
      ["snapshot_case_study", { study: A.studyId }],
      ["rotate_request_token", { request_id: A.requestId, new_hash: randomBytes(32).toString("hex"), purpose: "regenerate" }],
      ["revoke_request", { request_id: A.requestId }],
      ["save_wall_settings", { ws: A.ws, is_enabled: true, origins: ["https://evil.example"], chosen_layout: "grid", item_limit: 6 }],
      ["save_push_subscription", { ws: A.ws, push_endpoint: "https://fcm.googleapis.com/fcm/send/xxxxxxxxxxxxxxxxxxxx", push_p256dh: "B".repeat(87), push_auth: "a".repeat(22) }],
      ["save_notification_preferences", { ws: A.ws, on_client_completed: true, on_approval_received: true, on_referral_received: true }],
      ["create_invite", { ws: A.ws, invite_email: "bob@evil.test", invite_role: "owner", hash: randomBytes(32).toString("hex") }],
      ["create_proof_request", { ws: A.ws, client_name: "x", client_email: "x@x.test", project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: randomBytes(32).toString("hex") }],
    ] as const) {
      const res = await B.api.rpc(rpc[0], rpc[1] as Record<string, unknown>);
      expect(res.error, `B was allowed ${rpc[0]} on A's workspace`).not.toBeNull();
    }
    for (const [table, patch, key] of [["case_studies", { template_id: null }, "id"], ["referrals", { status: "won" }, "workspace_id"], ["workspace_communities", { notes: "pwned" }, "workspace_id"], ["workspaces", { name: "pwned" }, "id"]] as const) {
      const { data } = await B.api.from(table).update(patch).eq(key, key === "id" ? (table === "workspaces" ? A.ws : A.studyId) : A.ws).select();
      expect(data ?? [], `B updated A's ${table}`).toHaveLength(0);
    }
    const { data: del } = await B.api.from("case_studies").delete().eq("id", A.studyId).select();
    expect(del ?? []).toHaveLength(0);

    // A's data is exactly as it was.
    const { data: study } = await stack.admin.from("case_studies").select("status, content").eq("id", A.studyId).single();
    expect(study?.status).toBe("draft");
    expect(JSON.stringify(study?.content)).toContain("alice SECRET HEADLINE");
    expect((await stack.admin.from("referrals").select("status").eq("workspace_id", A.ws).single()).data?.status).toBe("new");
    expect((await stack.admin.from("workspaces").select("name").eq("id", A.ws).single()).data?.name).not.toBe("pwned");
  }, 240_000);
});

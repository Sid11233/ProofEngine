/** The resolver against the real database (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, loadLocalConfig, makeClient, type TestUser } from "../../supabase/tests/isolation/harness";
import { createResolver } from "./interview-access-core";
import { createMemoryLimiter } from "@/lib/security/rate-limit-memory";
import { generateToken } from "@/lib/security/tokens";

let admin: SupabaseClient;
let owner: TestUser;
let ws: string;
const users: string[] = [];

const resolver = () =>
  createResolver({
    admin,
    ipLimiter: createMemoryLimiter({ limit: 1000, windowMs: 60_000 }),
    tokenLimiter: createMemoryLimiter({ limit: 1000, windowMs: 60_000 }),
  });

async function makeRequest(flow: "agency" | "saas" = "agency") {
  const token = generateToken();
  const { data, error } = await owner.client.rpc("create_proof_request", {
    ws, client_name: "Dana Doe", client_email: "dana@example.test", project_type: null,
    flow_type: flow, focus_outcomes: [], tone: null, hash: token.hash,
  });
  if (error) throw new Error(error.message);
  return { token, id: String(data) };
}

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  owner = await createTestUser(cfg, admin, "access-owner");
  users.push(owner.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Access Co", type: "agency" })).data);
  await admin.from("workspaces").update({ plan: "pro" }).eq("id", ws);
}, 60_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  for (const id of users) await admin.auth.admin.deleteUser(id);
});

describe("resolveInterview against the database", () => {
  it("resolves a fresh link for both flows with the workspace name filled in", async () => {
    for (const flow of ["agency", "saas"] as const) {
      const { token } = await makeRequest(flow);
      const result = await resolver()(token.raw, { ip: "t" });
      expect(result.ok, `${flow} link did not resolve`).toBe(true);
      if (!result.ok) return;
      expect(result.access.workspaceId).toBe(ws);
      expect(result.access.interviewId).toBeNull();
      expect(result.access.view.clientFirstName).toBe("Dana");
      expect(result.access.view.questions).toHaveLength(6);
      expect(JSON.stringify(result.access.view.questions)).toContain("Access Co");
      expect(JSON.stringify(result.access.view.questions)).not.toContain("{{workspace}}");
    }
  });

  it("returns the same generic result for unknown, revoked, expired, completed and rotated links", async () => {
    const generic = { ok: false, reason: "not_found" };
    expect(await resolver()(generateToken().raw, { ip: "t" })).toEqual(generic);

    const revoked = await makeRequest();
    await owner.client.rpc("revoke_request", { request_id: revoked.id });
    expect(await resolver()(revoked.token.raw, { ip: "t" })).toEqual(generic);

    const expired = await makeRequest();
    await admin.from("proof_requests").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", expired.id);
    expect(await resolver()(expired.token.raw, { ip: "t" })).toEqual(generic);

    const completed = await makeRequest();
    await admin.from("proof_requests").update({ status: "completed" }).eq("id", completed.id);
    expect(await resolver()(completed.token.raw, { ip: "t" })).toEqual(generic);

    // Regenerating kills the old link at once; the new one works.
    const rotated = await makeRequest();
    const fresh = generateToken();
    expect((await owner.client.rpc("rotate_request_token", { request_id: rotated.id, new_hash: fresh.hash, purpose: "regenerate" })).error).toBeNull();
    expect(await resolver()(rotated.token.raw, { ip: "t" })).toEqual(generic);
    expect((await resolver()(fresh.raw, { ip: "t" })).ok).toBe(true);
  });

  it("revoking takes effect immediately", async () => {
    const { token, id } = await makeRequest();
    expect((await resolver()(token.raw, { ip: "t" })).ok).toBe(true);
    await owner.client.rpc("revoke_request", { request_id: id });
    expect((await resolver()(token.raw, { ip: "t" })).ok).toBe(false);
  });

  it("reports the existing interview once one has started", async () => {
    const { token, id } = await makeRequest();
    const { data } = await admin.from("interviews").insert({ request_id: id, workspace_id: ws }).select("id").single();
    await admin.from("proof_requests").update({ status: "started" }).eq("id", id);
    const result = await resolver()(token.raw, { ip: "t" });
    expect(result.ok && result.access.interviewId).toBe(data?.id);
  });
});

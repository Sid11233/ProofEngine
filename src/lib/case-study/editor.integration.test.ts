/** Autosave, snapshots and preview links against the real database (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, hex64, loadLocalConfig, makeClient, rowsOf, wasBlocked, type TestUser } from "../../../supabase/tests/isolation/harness";

let admin: SupabaseClient;
let anon: SupabaseClient;
let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let ws: string;
let otherWs: string;
const users: string[] = [];

const content = (headline: string, extra: Record<string, unknown> = {}) => ({
  headline,
  client: {},
  sections: [{ type: "challenge", title: "The challenge", body: "Body" }],
  tags: [],
  ...extra,
});

/** A case study with version 1 created `ageSeconds` ago. */
async function study({ ageSeconds = 0, status = "draft", workspace = ws, interviewId }: { ageSeconds?: number; status?: string; workspace?: string; interviewId?: string } = {}) {
  const base = content("Original");
  const { data } = await admin.from("case_studies").insert({ workspace_id: workspace, content: base, status, interview_id: interviewId }).select("id").single();
  const id = String(data?.id);
  await admin.from("case_study_versions").insert({
    case_study_id: id, workspace_id: workspace, version: 1, content: base, created_at: new Date(Date.now() - ageSeconds * 1000).toISOString(),
  });
  return id;
}

const state = async (id: string) => {
  const { data: cs } = await admin.from("case_studies").select("content, current_version, status").eq("id", id).single();
  const { data: versions } = await admin.from("case_study_versions").select("version, content").eq("case_study_id", id).order("version");
  return { cs: cs as { content: unknown; current_version: number; status: string }, versions: (versions ?? []) as Array<{ version: number; content: unknown }> };
};
const autosave = (user: TestUser, id: string, c: unknown, edited: string[] = []) => user.client.rpc("autosave_case_study", { study: id, new_content: c, edited_claims: edited });

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  anon = makeClient(cfg, "anon");
  [owner, editor, viewer, outsider] = await Promise.all(["ed-owner", "ed-editor", "ed-viewer", "ed-out"].map((l) => createTestUser(cfg, admin, l)));
  users.push(owner.id, editor.id, viewer.id, outsider.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Editor Co", type: "agency" })).data);
  otherWs = String((await outsider.client.rpc("create_workspace", { name: "Editor Other", type: "agency" })).data);
  await admin.from("workspace_members").insert([{ workspace_id: ws, user_id: editor.id, role: "editor" }, { workspace_id: ws, user_id: viewer.id, role: "viewer" }]);
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  await admin.from("workspaces").delete().eq("id", otherWs);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 120_000);

describe("autosave_case_study", () => {
  it("does nothing when the content has not changed", async () => {
    const id = await study({ ageSeconds: 600 });
    const res = await autosave(editor, id, content("Original"));
    expect(res.data).toEqual([{ version: 1, versioned: false }]);
    expect((await state(id)).versions).toHaveLength(1);
  });

  it("coalesces edits within a minute: content is current, no new version row", async () => {
    const id = await study({ ageSeconds: 5 });
    for (const headline of ["Typing", "Typing more", "Typing even more"]) {
      const res = await autosave(editor, id, content(headline));
      expect(res.error).toBeNull();
      expect(res.data).toEqual([{ version: 1, versioned: false }]);
    }
    const { cs, versions } = await state(id);
    expect(cs.content).toEqual(content("Typing even more"));
    expect(cs.current_version).toBe(1);
    expect(versions).toHaveLength(1);
    expect(versions[0].content, "the stored version must stay as it was until a snapshot").toEqual(content("Original"));
  });

  it("creates a new version when the last one is over a minute old", async () => {
    const id = await study({ ageSeconds: 120 });
    const res = await autosave(owner, id, content("After a pause"));
    expect(res.data).toEqual([{ version: 2, versioned: true }]);
    const { cs, versions } = await state(id);
    expect(cs).toMatchObject({ current_version: 2, status: "draft" });
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[1].content).toEqual(content("After a pause"));
    // And an immediate follow-up edit is coalesced into that new version.
    expect((await autosave(owner, id, content("Right after"))).data).toEqual([{ version: 2, versioned: false }]);
    expect((await state(id)).versions).toHaveLength(2);
  });

  it("always makes a new version when the study was awaiting approval, and returns it to draft", async () => {
    const id = await study({ ageSeconds: 1, status: "awaiting_client_approval" });
    const res = await autosave(editor, id, content("Edited while the client is reviewing"));
    expect(res.data).toEqual([{ version: 2, versioned: true }]);
    expect((await state(id)).cs.status).toBe("draft");
  });

  it("refuses a published page, and unauthorised callers", async () => {
    const live = await study({ status: "published", ageSeconds: 600 });
    expect((await autosave(owner, live, content("Edit live page"))).error?.code).toBe("22023");

    const id = await study({ ageSeconds: 600 });
    for (const [who, label] of [[viewer, "viewer"], [outsider, "outsider"]] as const) {
      expect((await autosave(who, id, content("Hacked"))).error, `${label} could autosave`).not.toBeNull();
    }
    expect((await anon.rpc("autosave_case_study", { study: id, new_content: content("Hacked"), edited_claims: [] })).error).not.toBeNull();
    expect((await state(id)).cs.content).toEqual(content("Original"));
  });

  it("rejects non-object, oversized, and malformed logo content", async () => {
    const id = await study({ ageSeconds: 600 });
    expect((await autosave(owner, id, "text")).error).not.toBeNull();
    expect((await autosave(owner, id, [])).error).not.toBeNull();
    expect((await autosave(owner, id, content("Big", { padding: "x".repeat(210_000) }))).error).not.toBeNull();

    const uuid = crypto.randomUUID();
    for (const logoPath of [`${otherWs}/logos/${uuid}.webp`, `${ws}/logos/../x.webp`, `${ws}/${uuid}.webp`, `${ws}/logos/${uuid}.png`, "https://evil.example/x.webp", "../../etc/passwd"]) {
      expect((await autosave(owner, id, content("Logo", { client: { logoPath } }))).error, `accepted logo ${logoPath}`).not.toBeNull();
    }
    expect((await autosave(owner, id, content("Logo", { client: { logoPath: `${ws}/logos/${uuid}.webp` } }))).error).toBeNull();
  });

  it("sets edited flags on claims and revokes their confirmation, and clears them on revert", async () => {
    const { data: interview } = await admin.from("interviews").insert({ request_id: (await admin.from("proof_requests").insert({ workspace_id: ws, client_name: "C", client_email: "c@e.test", flow_type: "agency", token_hash: hex64(), expires_at: new Date(Date.now() + 86_400_000).toISOString() }).select("id").single()).data?.id, workspace_id: ws, status: "completed", consent_given: true }).select("id").single();
    // The case study must belong to the interview the claim quotes.
    const id = await study({ ageSeconds: 600, interviewId: String(interview?.id) });
    const { data: msg } = await admin.from("interview_messages").insert({ interview_id: interview?.id, workspace_id: ws, role: "client", content: "We cut time by 40 percent" }).select("id").single();
    const { data: claim } = await admin.from("claims").insert({ case_study_id: id, workspace_id: ws, text: "t", source_message_id: msg?.id, source_quote: "cut time by 40 percent", client_confirmed: true }).select("id").single();

    await autosave(owner, id, content("Edit 1"), [String(claim?.id)]);
    expect((await admin.from("claims").select("edited, client_confirmed").eq("id", claim?.id).single()).data).toEqual({ edited: true, client_confirmed: false });
    await autosave(owner, id, content("Edit 2"), []);
    expect((await admin.from("claims").select("edited").eq("id", claim?.id).single()).data?.edited).toBe(false);
  });
});

describe("snapshot_case_study", () => {
  it("makes the stored versions catch up with the content, and only when needed", async () => {
    const id = await study({ ageSeconds: 5 });
    await autosave(editor, id, content("Coalesced edit"));
    expect((await state(id)).versions[0].content).toEqual(content("Original"));

    const res = await editor.client.rpc("snapshot_case_study", { study: id });
    expect(res.data).toBe(2);
    const { cs, versions } = await state(id);
    expect(cs.current_version).toBe(2);
    expect(versions[1].content).toEqual(content("Coalesced edit"));

    expect((await editor.client.rpc("snapshot_case_study", { study: id })).data, "snapshotting twice made another version").toBe(2);
    expect((await state(id)).versions).toHaveLength(2);
  });

  it("is editor+ only", async () => {
    const id = await study();
    for (const who of [viewer, outsider]) expect((await who.client.rpc("snapshot_case_study", { study: id })).error).not.toBeNull();
    expect((await anon.rpc("snapshot_case_study", { study: id })).error).not.toBeNull();
  });
});

describe("preview links", () => {
  const create = (who: TestUser, id: string, hash = hex64()) => who.client.rpc("create_preview_link", { study: id, hash });

  it("creates a link that stores only a hash, expires in 14 days, and is audited", async () => {
    const id = await study();
    const hash = hex64();
    const res = await create(editor, id, hash);
    expect(res.error).toBeNull();
    const { data } = await admin.from("case_study_previews").select("*").eq("id", res.data).single();
    expect(data).toMatchObject({ case_study_id: id, workspace_id: ws, token_hash: hash, revoked_at: null, created_by: editor.id });
    const days = (Date.parse(String(data?.expires_at)) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    expect((await admin.from("audit_log").select("action").eq("workspace_id", ws).eq("action", "preview.create")).data?.length).toBeGreaterThan(0);
  });

  it("is editor+ only, tenant-scoped, and refused for published pages and bad hashes", async () => {
    const id = await study();
    for (const who of [viewer, outsider]) expect((await create(who, id)).error, "non-editor created a preview").not.toBeNull();
    expect((await anon.rpc("create_preview_link", { study: id, hash: hex64() })).error).not.toBeNull();
    expect((await create(owner, id, "not-a-hash")).error).not.toBeNull();
    const live = await study({ status: "published" });
    expect((await create(owner, live)).error?.code).toBe("22023");
  });

  it("allows at most 10 active links per case study; revoking frees a slot", async () => {
    const id = await study();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await create(owner, id);
      expect(r.error, `link ${i + 1}`).toBeNull();
      ids.push(String(r.data));
    }
    expect((await create(owner, id)).error?.code).toBe("54000");
    expect((await owner.client.rpc("revoke_preview_link", { preview: ids[0] })).error).toBeNull();
    expect((await create(owner, id)).error).toBeNull();
  });

  it("revoking is editor+ only and idempotent", async () => {
    const id = await study();
    const preview = String((await create(owner, id)).data);
    for (const who of [viewer, outsider]) expect((await who.client.rpc("revoke_preview_link", { preview })).error).not.toBeNull();
    expect((await editor.client.rpc("revoke_preview_link", { preview })).error).toBeNull();
    const first = (await admin.from("case_study_previews").select("revoked_at").eq("id", preview).single()).data?.revoked_at;
    expect(first).not.toBeNull();
    expect((await owner.client.rpc("revoke_preview_link", { preview })).error).toBeNull();
    expect((await admin.from("case_study_previews").select("revoked_at").eq("id", preview).single()).data?.revoked_at).toBe(first);
  });

  it("is visible to editors and above only, never with the token hash, and cannot be written directly", async () => {
    const id = await study();
    await create(owner, id);
    const cols = "id, case_study_id, expires_at, revoked_at";
    expect(rowsOf(await editor.client.from("case_study_previews").select(cols).eq("case_study_id", id)).length).toBeGreaterThan(0);
    for (const who of [viewer, outsider]) expect(rowsOf(await who.client.from("case_study_previews").select(cols).eq("case_study_id", id))).toHaveLength(0);
    expect(rowsOf(await anon.from("case_study_previews").select(cols))).toHaveLength(0);
    expect((await owner.client.from("case_study_previews").select("token_hash")).error).not.toBeNull();
    expect((await owner.client.from("case_study_previews").select("*")).error).not.toBeNull();

    expect(wasBlocked(await owner.client.from("case_study_previews").insert({ case_study_id: id, workspace_id: ws, token_hash: hex64() }).select())).toBe(true);
    expect(wasBlocked(await owner.client.from("case_study_previews").update({ revoked_at: null, expires_at: new Date(Date.now() + 9e9).toISOString() }).eq("case_study_id", id).select())).toBe(true);
    expect(wasBlocked(await owner.client.from("case_study_previews").delete().eq("case_study_id", id).select())).toBe(true);
  });

  it("a link longer than 14 days cannot exist", async () => {
    const id = await study();
    const { error } = await admin.from("case_study_previews").insert({ case_study_id: id, workspace_id: ws, token_hash: hex64(), expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() });
    expect(error?.code).toBe("23514");
  });
});

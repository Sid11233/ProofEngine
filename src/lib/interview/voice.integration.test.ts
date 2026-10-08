/** Voice answers against the real database and storage (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InterviewAccess } from "@/lib/interview-access-core";
import { createSupabaseStore } from "@/lib/uploads/store";
import { createTestUser, loadLocalConfig, makeClient, type TestUser } from "../../../supabase/tests/isolation/harness";
import { attachVoice, purgeExpiredVoice, recordVoice, VOICE_BUCKET } from "./voice";

let admin: SupabaseClient;
let owner: TestUser;
let outsider: TestUser;
let ws: string;
let wsOther: string;
let interviewId: string;
let messageId: string;
let access: InterviewAccess;
const users: string[] = [];
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 9, 9, 9, 9]);

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  [owner, outsider] = await Promise.all(["vo-owner", "vo-out"].map((l) => createTestUser(cfg, admin, l)));
  users.push(owner.id, outsider.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Voice Co", type: "agency" })).data);
  wsOther = String((await outsider.client.rpc("create_workspace", { name: "Other Co", type: "agency" })).data);
  const { data: request } = await admin.from("proof_requests").insert({ workspace_id: ws, client_name: "Dana", client_email: "d@example.test", flow_type: "agency", token_hash: randomBytes(32).toString("hex"), expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: "started" }).select("id").single();
  const { data: interview } = await admin.from("interviews").insert({ request_id: request?.id, workspace_id: ws, status: "started", consent_given: true }).select("id").single();
  interviewId = String(interview?.id);
  const { data: msg } = await admin.from("interview_messages").insert({ interview_id: interviewId, workspace_id: ws, role: "client", content: "My answer" }).select("id").single();
  messageId = String(msg?.id);
  access = { workspaceId: ws, interviewId } as unknown as InterviewAccess;
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().in("id", [ws, wsOther]);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 120_000);

const store = () => createSupabaseStore(admin, VOICE_BUCKET);

describe("voice recordings", () => {
  it("stores the file privately and the row for members only; attaches once; clients cannot touch the bucket", async () => {
    const r = await recordVoice({ admin, store: store(), transcribe: async () => "Spoken words" }, access, webm);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { data: row } = await admin.from("interview_voice").select("file_path, mime_type, expires_at, message_id").eq("id", r.voiceId).single();
    expect(row).toMatchObject({ mime_type: "audio/webm", message_id: null });
    expect(Date.parse(String(row?.expires_at)) - Date.now()).toBeGreaterThan(29 * 86_400_000);
    expect((await admin.storage.from(VOICE_BUCKET).download(String(row?.file_path))).error).toBeNull();

    expect((await owner.client.from("interview_voice").select("id").eq("id", r.voiceId)).data).toHaveLength(1);
    expect((await outsider.client.from("interview_voice").select("id").eq("id", r.voiceId)).data).toHaveLength(0);
    expect((await owner.client.storage.from(VOICE_BUCKET).download(String(row?.file_path))).error).not.toBeNull();
    expect((await owner.client.storage.from(VOICE_BUCKET).upload(`${ws}/${interviewId}/x.webm`, webm, { contentType: "audio/webm" })).error).not.toBeNull();

    await attachVoice(admin, access, r.voiceId, messageId);
    expect((await admin.from("interview_voice").select("message_id").eq("id", r.voiceId).single()).data?.message_id).toBe(messageId);
    // a second attach to another message, or from another interview, changes nothing
    const { data: other } = await admin.from("interview_messages").insert({ interview_id: interviewId, workspace_id: ws, role: "client", content: "Another" }).select("id").single();
    await attachVoice(admin, access, r.voiceId, String(other?.id));
    expect((await admin.from("interview_voice").select("message_id").eq("id", r.voiceId).single()).data?.message_id).toBe(messageId);
    await attachVoice(admin, { workspaceId: ws, interviewId: "99999999-9999-4999-8999-999999999999" } as unknown as InterviewAccess, r.voiceId, String(other?.id));
    expect((await admin.from("interview_voice").select("message_id").eq("id", r.voiceId).single()).data?.message_id).toBe(messageId);
  });

  it("the database refuses rows with a wrong path, type or size", async () => {
    const good = { workspace_id: ws, interview_id: interviewId, file_path: `${ws}/${interviewId}/${"a".repeat(8)}-aaaa-aaaa-aaaa-${"a".repeat(12)}.webm`, mime_type: "audio/webm", size_bytes: 10, consent_text_version: "voice-2026-10-v1" };
    for (const bad of [{ file_path: "../../etc/passwd" }, { file_path: `${wsOther}/${interviewId}/${"a".repeat(8)}-aaaa-aaaa-aaaa-${"a".repeat(12)}.webm` }, { mime_type: "text/html" }, { size_bytes: 6_000_000 }, { size_bytes: 0 }]) {
      expect((await admin.from("interview_voice").insert({ ...good, ...bad })).error, JSON.stringify(bad)).not.toBeNull();
    }
  });

  it("the purge job removes expired recordings, file first, and leaves current ones", async () => {
    const fresh = await recordVoice({ admin, store: store(), transcribe: async () => "Fresh" }, access, webm);
    const old = await recordVoice({ admin, store: store(), transcribe: async () => "Old" }, access, webm);
    if (!fresh.ok || !old.ok) throw new Error("setup");
    const { data: oldRow } = await admin.from("interview_voice").select("file_path").eq("id", old.voiceId).single();
    await admin.from("interview_voice").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", old.voiceId);
    expect(await purgeExpiredVoice(admin)).toBeGreaterThanOrEqual(1);
    expect((await admin.from("interview_voice").select("id").eq("id", old.voiceId)).data).toHaveLength(0);
    expect((await admin.storage.from(VOICE_BUCKET).download(String(oldRow?.file_path))).error).not.toBeNull();
    expect((await admin.from("interview_voice").select("id").eq("id", fresh.voiceId)).data).toHaveLength(1);
  });
});

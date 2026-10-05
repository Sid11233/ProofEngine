/** Uploads, simple form, AI cap and spend breaker against the real database (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestUser, loadLocalConfig, makeClient, type TestUser } from "../../../supabase/tests/isolation/harness";
import { answerQuestion, beginInterview, loadTranscript, type InterviewerDeps } from "@/lib/ai/interviewer";
import type { AiClient } from "@/lib/ai/client";
import { createResolver, type InterviewAccess } from "@/lib/interview-access-core";
import { CONSENT_VERSION } from "@/lib/interview/consent";
import { isBreakerTripped } from "./breaker";
import { submitSimpleForm } from "./form";
import { createMemoryLimiter } from "@/lib/security/rate-limit-memory";
import { generateToken } from "@/lib/security/tokens";
import { storeInterviewUpload } from "@/lib/uploads/service";
import type { UploadStore } from "@/lib/uploads/store";

let admin: SupabaseClient;
let owner: TestUser;
let ws: string;
const users: string[] = [];

function fakeStore() {
  const files = new Map<string, Uint8Array>();
  const store: UploadStore = {
    async put(path, data) { files.set(path, data); return true; },
    async remove(path) { files.delete(path); },
    async signedUrl(path) { return files.has(path) ? `https://signed.example/${path}?t=1` : null; },
  };
  return { files, store };
}

async function newInterview() {
  const token = generateToken();
  const { error } = await owner.client.rpc("create_proof_request", {
    ws, client_name: "Pat Client", client_email: "pat@example.test", project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: token.hash,
  });
  if (error) throw new Error(error.message);
  const resolve = createResolver({ admin, ipLimiter: createMemoryLimiter({ limit: 999, windowMs: 60_000 }), tokenLimiter: createMemoryLimiter({ limit: 999, windowMs: 60_000 }) });
  const first = await resolve(token.raw, { ip: "t" });
  if (!first.ok) throw new Error("resolve");
  const begun = await beginInterview(admin, first.access, CONSENT_VERSION);
  if (!begun.ok) throw new Error("begin");
  const again = await resolve(token.raw, { ip: "t" });
  if (!again.ok) throw new Error("resolve2");
  return { access: again.access as InterviewAccess, interviewId: begun.interviewId };
}

const image = (type: "png" | "jpeg" = "png") => sharp({ create: { width: 64, height: 64, channels: 3, background: "#336699" } })[type]().toBuffer();
const row = async (id: string) => (await admin.from("interviews").select("*").eq("id", id).single()).data as Record<string, unknown>;
const LONG = "We were struggling with a slow manual process that cost the team many hours every week and made clients wait far too long";

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  owner = await createTestUser(cfg, admin, "abuse-owner");
  users.push(owner.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Abuse Co", type: "agency" })).data);
  await admin.from("workspaces").update({ plan: "team" }).eq("id", ws);
}, 60_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  for (const id of users) await admin.auth.admin.deleteUser(id);
});

describe("uploads", () => {
  it("stores a re-encoded WebP under {workspace}/{interview}/{uuid}.webp and never uses the file name", async () => {
    const { access, interviewId } = await newInterview();
    const { files, store } = fakeStore();
    const result = await storeInterviewUpload({ admin, store }, access, { kind: "logo", filename: "My Secret Client Logo.PNG", bytes: await image("png") });
    expect(result.ok).toBe(true);

    const { data } = await admin.from("interview_uploads").select("*").eq("interview_id", interviewId);
    expect(data).toHaveLength(1);
    expect(data?.[0].file_path).toMatch(new RegExp(`^${ws}/${interviewId}/[0-9a-f-]{36}\\.webp$`));
    expect(data?.[0].file_path).not.toMatch(/secret|logo|png/i);
    expect(data?.[0]).toMatchObject({ kind: "logo", workspace_id: ws });
    const stored = files.get(String(data?.[0].file_path))!;
    expect((await sharp(stored).metadata()).format).toBe("webp");
    expect(data?.[0].size_bytes).toBe(stored.length);
  });

  it("rejects a renamed .exe, an SVG and an oversized file without storing anything", async () => {
    const { access, interviewId } = await newInterview();
    const { files, store } = fakeStore();
    const exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, ...new Array(64).fill(0)]);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set((await image("png")).subarray(0, 8));

    expect(await storeInterviewUpload({ admin, store }, access, { kind: "logo", filename: "logo.png", bytes: exe })).toEqual({ ok: false, error: "bad_content" });
    expect(await storeInterviewUpload({ admin, store }, access, { kind: "logo", filename: "logo.svg", bytes: svg })).toEqual({ ok: false, error: "bad_extension" });
    expect(await storeInterviewUpload({ admin, store }, access, { kind: "headshot", filename: "me.png", bytes: svg })).toEqual({ ok: false, error: "bad_content" });
    expect(await storeInterviewUpload({ admin, store }, access, { kind: "headshot", filename: "me.png", bytes: big })).toEqual({ ok: false, error: "too_large" });
    expect(await storeInterviewUpload({ admin, store }, access, { kind: "headshot", filename: "me.png", bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) })).toEqual({ ok: false, error: "bad_content" });
    expect(files.size).toBe(0);
    expect((await admin.from("interview_uploads").select("id").eq("interview_id", interviewId)).data).toHaveLength(0);
  });

  it("allows at most 4 files per interview and removes the stored object when the cap is hit", async () => {
    const { access, interviewId } = await newInterview();
    const { files, store } = fakeStore();
    const remove = vi.spyOn(store, "remove");
    for (let i = 0; i < 4; i++) {
      expect((await storeInterviewUpload({ admin, store }, access, { kind: i % 2 ? "headshot" : "logo", filename: `f${i}.png`, bytes: await image() })).ok).toBe(true);
    }
    const fifth = await storeInterviewUpload({ admin, store }, access, { kind: "logo", filename: "f5.png", bytes: await image() });
    expect(fifth).toEqual({ ok: false, error: "limit_reached" });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(files.size, "an orphaned file was left in storage").toBe(4);
    expect((await admin.from("interview_uploads").select("id").eq("interview_id", interviewId)).data).toHaveLength(4);
  });

  it("needs an open interview with a started consent", async () => {
    const { access } = await newInterview();
    expect(await storeInterviewUpload({ admin, store: fakeStore().store }, { ...access, interviewId: null }, { kind: "logo", filename: "a.png", bytes: await image() })).toEqual({ ok: false, error: "closed" });
  });

  it("record_upload refuses paths outside the interview, bad kinds and audio, and is server-only", async () => {
    const { access, interviewId } = await newInterview();
    const other = await newInterview();
    const uuid = crypto.randomUUID();
    const call = (args: Record<string, unknown>) => admin.rpc("record_upload", { intr: interviewId, ws, path: `${ws}/${interviewId}/${uuid}.webp`, upload_kind: "logo", size: 100, ...args });
    expect((await call({ path: `${ws}/${other.interviewId}/${uuid}.webp` })).error, "path in another interview accepted").not.toBeNull();
    expect((await call({ path: `${ws}/${interviewId}/../x.webp` })).error).not.toBeNull();
    expect((await call({ path: `${ws}/${interviewId}/${uuid}.exe` })).error).not.toBeNull();
    expect((await call({ upload_kind: "audio" })).error).not.toBeNull();
    expect((await call({ size: 3_000_000 })).error).not.toBeNull();
    expect((await call({})).error).toBeNull();

    for (const client of [owner.client, makeClient(loadLocalConfig(), "anon")]) {
      expect((await client.rpc("record_upload", { intr: interviewId, ws: access.workspaceId, path: `${ws}/${interviewId}/${uuid}.webp`, upload_kind: "logo", size: 1 })).error, "record_upload callable by a client").not.toBeNull();
    }
  });

  it("the store hands out short-lived signed links only", async () => {
    const { files, store } = fakeStore();
    files.set("a/b/c.webp", new Uint8Array([1]));
    expect(await store.signedUrl("a/b/c.webp")).toContain("signed.example");
    expect(await store.signedUrl("missing.webp")).toBeNull();
  });
});

describe("simple form fallback", () => {
  it("produces the same transcript shape as the chat and finishes the interview", async () => {
    const { access, interviewId } = await newInterview();
    const answers = access.view.questions.map((q) => ({ questionId: q.id, answer: `Form answer to ${q.id}` }));
    expect(await submitSimpleForm(admin, access, { token: "x", answers })).toEqual({ ok: true });

    const state = await loadTranscript(admin, interviewId, ws, 6);
    expect(state.done).toBe(true);
    expect(state.messages.map((m) => m.role)).toEqual(["bot", "client", "bot", "client", "bot", "client", "bot", "client", "bot", "client", "bot", "client", "bot"]);
    expect(state.messages.filter((m) => m.role === "client").map((m) => m.content)).toEqual(answers.map((a) => a.answer));
    expect(state.messages.filter((m) => m.role === "bot").slice(0, 6).map((m) => m.content)).toEqual(access.view.questions.map((q) => q.text));
    expect(await row(interviewId)).toMatchObject({ question_index: 6, status: "started", message_count: 13 });
  });

  it("continues from where the chat stopped", async () => {
    const { access, interviewId } = await newInterview();
    const deps: InterviewerDeps = { admin, ai: null, messageLimiter: createMemoryLimiter({ limit: 99, windowMs: 60_000 }) };
    await answerQuestion(deps, access, LONG);
    await answerQuestion(deps, access, LONG);
    const rest = access.view.questions.slice(2).map((q) => ({ questionId: q.id, answer: "short" }));
    expect(await submitSimpleForm(admin, access, { token: "x", answers: rest })).toEqual({ ok: true });
    expect((await row(interviewId)).question_index).toBe(6);
  });

  it("rejects answers that do not match the remaining questions, wrong order, or an empty form", async () => {
    const { access, interviewId } = await newInterview();
    const qs = access.view.questions;
    const all = qs.map((q) => ({ questionId: q.id, answer: "ok" }));
    expect((await submitSimpleForm(admin, access, { token: "x", answers: all.slice(0, 3) })).ok).toBe(false);
    expect((await submitSimpleForm(admin, access, { token: "x", answers: [...all].reverse() })).ok).toBe(false);
    expect((await submitSimpleForm(admin, access, { token: "x", answers: all.map((a, i) => (i === 2 ? { ...a, questionId: "q99" } : a)) })).ok).toBe(false);
    expect((await row(interviewId)).question_index, "a rejected form changed the interview").toBe(0);
    expect((await submitSimpleForm(admin, { ...access, interviewId: null }, { token: "x", answers: all })).ok).toBe(false);
  });

  it("is subject to the same message cap as the chat", async () => {
    const { access, interviewId } = await newInterview();
    await admin.from("interviews").update({ message_count: 40 }).eq("id", interviewId);
    const answers = access.view.questions.map((q) => ({ questionId: q.id, answer: "ok" }));
    expect(await submitSimpleForm(admin, access, { token: "x", answers })).toMatchObject({ ok: false, error: "limit_reached" });
  });

  it("cannot be used twice", async () => {
    const { access } = await newInterview();
    const answers = access.view.questions.map((q) => ({ questionId: q.id, answer: "ok" }));
    await submitSimpleForm(admin, access, { token: "x", answers });
    expect((await submitSimpleForm(admin, access, { token: "x", answers })).ok).toBe(false);
  });
});

describe("monthly AI cap", () => {
  it("falls back to canned lines and spends nothing once the cap is reached", async () => {
    const { access } = await newInterview();
    const complete = vi.fn(async () => ({ text: "Thanks for that.", inputTokens: 5, outputTokens: 5 }));
    const ai: AiClient = { complete };
    let allowed = true;
    const deps: InterviewerDeps = { admin, ai, messageLimiter: createMemoryLimiter({ limit: 99, windowMs: 60_000 }), canUseAi: async () => allowed };

    expect((await answerQuestion(deps, access, LONG)).ok).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);

    allowed = false;
    const capped = await answerQuestion(deps, access, LONG);
    expect(capped.ok && capped.reply.endsWith(access.view.questions[2].text)).toBe(true);
    expect(complete, "the model was called after the cap").toHaveBeenCalledTimes(1);
  });
});

describe("global daily spend circuit breaker", () => {
  const today = () => new Date().toISOString().slice(0, 10);

  it("stays closed under the limit, opens above it, and alerts exactly once", async () => {
    await admin.from("ai_daily_usage").delete().eq("day", today());
    const alert = vi.fn(async () => undefined);
    expect(await isBreakerTripped(admin, 1000, alert)).toBe(false);

    await admin.from("ai_daily_usage").upsert({ day: today(), tokens: 999, alerted: false });
    expect(await isBreakerTripped(admin, 1000, alert)).toBe(false);

    await admin.from("ai_daily_usage").update({ tokens: 1000 }).eq("day", today());
    expect(await isBreakerTripped(admin, 1000, alert)).toBe(true);
    expect(await isBreakerTripped(admin, 1000, alert)).toBe(true);
    expect(await isBreakerTripped(admin, 1000, alert)).toBe(true);
    expect(alert, "the alert fired more than once").toHaveBeenCalledTimes(1);
    await admin.from("ai_daily_usage").delete().eq("day", today());
  });

  it("is fed by real interview traffic", async () => {
    await admin.from("ai_daily_usage").delete().eq("day", today());
    const { access } = await newInterview();
    const ai: AiClient = { async complete() { return { text: "Thanks.", inputTokens: 700, outputTokens: 50 }; } };
    await answerQuestion({ admin, ai, messageLimiter: createMemoryLimiter({ limit: 9, windowMs: 60_000 }) }, access, LONG);
    const { data } = await admin.from("ai_daily_usage").select("tokens").eq("day", today()).single();
    expect(Number(data?.tokens)).toBe(750);
    expect(await isBreakerTripped(admin, 700, async () => undefined)).toBe(true);
    await admin.from("ai_daily_usage").delete().eq("day", today());
  });

  it("keeps serving if the check itself fails", async () => {
    const broken = { rpc: async () => ({ data: null, error: { message: "boom" } }) } as unknown as SupabaseClient;
    expect(await isBreakerTripped(broken, 1, async () => undefined)).toBe(false);
  });

  it("the usage table is invisible to every client, workspace owners included", async () => {
    await admin.from("ai_daily_usage").upsert({ day: today(), tokens: 5 });
    for (const client of [owner.client, makeClient(loadLocalConfig(), "anon")]) {
      const read = await client.from("ai_daily_usage").select("*");
      expect(read.data ?? [], "ai_daily_usage readable by a client").toHaveLength(0);
      expect((await client.from("ai_daily_usage").update({ tokens: 0 }).eq("day", today()).select()).data ?? []).toHaveLength(0);
      expect((await client.from("ai_daily_usage").insert({ day: "2020-01-01", tokens: 1 }).select()).error).not.toBeNull();
      expect((await client.rpc("check_ai_breaker", { token_limit: 1 })).error, "check_ai_breaker callable by a client").not.toBeNull();
    }
    await admin.from("ai_daily_usage").delete().eq("day", today());
  });
});

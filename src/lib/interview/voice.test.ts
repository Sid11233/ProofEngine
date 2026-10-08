import { describe, expect, it, vi } from "vitest";
import type { InterviewAccess } from "@/lib/interview-access-core";
import { attachVoice, detectAudio, MAX_VOICE_BYTES, MAX_VOICES_PER_INTERVIEW, purgeExpiredVoice, recordVoice, VOICE_CONSENT_TEXT, voicePath } from "./voice";

const WS = "11111111-1111-4111-8111-111111111111";
const IV = "22222222-2222-4222-8222-222222222222";
const access = { workspaceId: WS, interviewId: IV } as unknown as InterviewAccess;
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);

function fakes(opts: { count?: number; insertError?: { code: string } } = {}) {
  const files = new Map<string, Uint8Array>();
  const rows: Array<Record<string, unknown>> = [];
  const store = { put: async (p: string, d: Uint8Array) => (files.set(p, d), true), remove: async (p: string) => void files.delete(p), signedUrl: async () => null };
  const admin = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: async () => ({ count: opts.count ?? 0 }) }) }),
      insert: (row: Record<string, unknown>) => ({ select: () => ({ single: async () => (opts.insertError ? { data: null, error: opts.insertError } : (rows.push(row), { data: { id: "voice-1" }, error: null })) }) }),
    }),
  } as never;
  return { files, rows, store, admin };
}

describe("detectAudio", () => {
  it("decides the type from the bytes, never from a label", () => {
    expect(detectAudio(webm)).toBe("audio/webm");
    expect(detectAudio(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0]))).toBe("audio/ogg");
    expect(detectAudio(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBe("audio/wav");
    expect(detectAudio(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41]))).toBe("audio/mp4");
    for (const bad of [new TextEncoder().encode("<svg onload=alert(1)>"), new TextEncoder().encode("MZ executable"), new Uint8Array([0x89, 0x50, 0x4e, 0x47]), new Uint8Array(0)]) expect(detectAudio(bad)).toBeNull();
  });
});

describe("recordVoice", () => {
  const transcribe = vi.fn(async () => "Hello from the recording");
  it("transcribes, stores under the interview path, records the row with the consent version", async () => {
    const f = fakes();
    const r = await recordVoice({ admin: f.admin, store: f.store, transcribe }, access, webm);
    expect(r).toEqual({ ok: true, voiceId: "voice-1", text: "Hello from the recording" });
    const [path] = [...f.files.keys()];
    expect(path).toMatch(new RegExp(`^${WS}/${IV}/[0-9a-f-]{36}\\.webm$`));
    expect(f.rows[0]).toMatchObject({ workspace_id: WS, interview_id: IV, mime_type: "audio/webm", size_bytes: 8, consent_text_version: "voice-2026-10-v1", transcript_chars: 24 });
  });
  it("refuses empty, oversized, non-audio, over-limit and closed interviews without calling the provider", async () => {
    const spy = vi.fn(async () => "x");
    const run = (bytes: Uint8Array, f = fakes(), a = access) => recordVoice({ admin: f.admin, store: f.store, transcribe: spy }, a, bytes);
    expect(await run(new Uint8Array(0))).toEqual({ ok: false, error: "empty" });
    expect(await run(new Uint8Array(MAX_VOICE_BYTES + 1))).toEqual({ ok: false, error: "too_large" });
    expect(await run(new TextEncoder().encode("not audio"))).toEqual({ ok: false, error: "bad_audio" });
    expect(await run(webm, fakes({ count: MAX_VOICES_PER_INTERVIEW }))).toEqual({ ok: false, error: "limit_reached" });
    expect(await run(webm, fakes(), { ...access, interviewId: null } as unknown as InterviewAccess)).toEqual({ ok: false, error: "closed" });
    expect(spy).not.toHaveBeenCalled();
  });
  it("stores nothing when transcription fails, and removes the file when the row cannot be written", async () => {
    const f = fakes();
    expect(await recordVoice({ admin: f.admin, store: f.store, transcribe: async () => { throw new Error("sk-secret"); } }, access, webm)).toEqual({ ok: false, error: "transcribe_failed" });
    expect(f.files.size).toBe(0);
    const g = fakes({ insertError: { code: "54000" } });
    expect(await recordVoice({ admin: g.admin, store: g.store, transcribe }, access, webm)).toEqual({ ok: false, error: "limit_reached" });
    expect(g.files.size).toBe(0);
  });
  it("paths come from ids only; the notice says what happens to the recording", () => {
    expect(voicePath(WS, IV, "audio/ogg")).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.ogg$/);
    expect(VOICE_CONSENT_TEXT).toMatch(/30 days/);
    expect(VOICE_CONSENT_TEXT).toMatch(/speech-to-text/);
  });
});

describe("attachVoice and purgeExpiredVoice", () => {
  it("attaches only this interview's own recording that has no answer yet", async () => {
    const calls: Array<[string, unknown]> = [];
    const chain: Record<string, unknown> = {};
    for (const m of ["update", "eq", "is"]) chain[m] = (...a: unknown[]) => (calls.push([m, a]), chain);
    await attachVoice({ from: () => chain } as never, access, "v-1", "m-1");
    expect(calls).toEqual([["update", [{ message_id: "m-1" }]], ["eq", ["id", "v-1"]], ["eq", ["interview_id", IV]], ["eq", ["workspace_id", WS]], ["is", ["message_id", null]]]);
    await attachVoice({ from: () => chain } as never, { ...access, interviewId: null } as unknown as InterviewAccess, "v", "m");
    expect(calls).toHaveLength(5);
  });
  it("removes the file before the row, and keeps the row when the file cannot be removed", async () => {
    const order: string[] = [];
    const rows = [{ id: "a", file_path: "p/a.webm" }, { id: "b", file_path: "p/b.webm" }];
    const admin = {
      from: () => ({ select: () => ({ lt: () => ({ limit: async () => ({ data: rows }) }) }), delete: () => ({ eq: async (_c: string, id: string) => (order.push(`row:${id}`), { error: null }) }) }),
      storage: { from: () => ({ remove: async ([p]: string[]) => (order.push(`file:${p}`), { error: p.includes("b.webm") ? { message: "storage down" } : null }) }) },
    } as never;
    expect(await purgeExpiredVoice(admin)).toBe(1);
    expect(order).toEqual(["file:p/a.webm", "row:a", "file:p/b.webm"]);
  });
});

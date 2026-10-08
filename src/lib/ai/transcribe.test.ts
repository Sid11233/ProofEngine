import { describe, expect, it, vi } from "vitest";
import { transcribeAudio, TranscribeError } from "./transcribe";

const ok = (text: unknown) => vi.fn(async () => new Response(JSON.stringify({ text }), { status: 200 }));

describe("transcribeAudio", () => {
  it("sends the audio, model and key, and returns clean text", async () => {
    const fetchImpl = ok("  Hello   there\n friend ");
    const text = await transcribeAudio({ apiKey: "sk-test-key-123456789012345", fetchImpl }, new Uint8Array([1, 2, 3]), "audio/webm");
    expect(text).toBe("Hello there friend");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test-key-123456789012345");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect((form.get("file") as File).name).toBe("answer.webm");
    expect([...form.keys()].sort()).toEqual(["file", "model", "response_format"]); // nothing else about the client is sent
  });
  it("caps the transcript at the length of a typed answer", async () => {
    expect((await transcribeAudio({ apiKey: "k".repeat(30), fetchImpl: ok("a".repeat(5000)) }, new Uint8Array([1]), "audio/ogg")).length).toBe(1000);
  });
  it("fails with a status only: provider errors, empty text, network trouble", async () => {
    const fail = (fetchImpl: typeof fetch) => transcribeAudio({ apiKey: "k".repeat(30), fetchImpl }, new Uint8Array([1]), "audio/wav").catch((e) => e);
    expect(await fail(vi.fn(async () => new Response("secret body sk-123", { status: 401 })))).toMatchObject({ status: 401, message: "Transcription failed (401)" });
    expect(await fail(ok("   "))).toMatchObject({ status: "empty" });
    expect(await fail(vi.fn(async () => { throw new Error("sk-leak in message"); }))).toMatchObject({ status: "network", message: "Transcription failed (network)" });
    expect(new TranscribeError(500).message).not.toContain("sk-");
  });
});

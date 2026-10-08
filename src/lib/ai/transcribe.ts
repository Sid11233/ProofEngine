// Speech to text over plain HTTPS (no SDK). The audio is sent to the provider and nothing else: no token, name, email
// or id. The text that comes back is untrusted data like any client answer. Errors carry only a status, never a body.

export const DEFAULT_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
export const DEFAULT_TRANSCRIBE_MODEL = "whisper-1";
export const MAX_TRANSCRIPT_CHARS = 1000;

export class TranscribeError extends Error {
  constructor(readonly status: number | "network" | "timeout" | "empty") {
    super(`Transcription failed (${status})`);
  }
}

const EXTENSION: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/wav": "wav" };

export interface TranscribeDeps {
  apiKey: string;
  model?: string;
  url?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Returns the transcript text (trimmed, at most 1000 characters, the length of a typed answer). */
export async function transcribeAudio(deps: TranscribeDeps, bytes: Uint8Array, mime: string): Promise<string> {
  const { apiKey, model = DEFAULT_TRANSCRIBE_MODEL, url = DEFAULT_TRANSCRIBE_URL, fetchImpl = fetch, timeoutMs = 45_000 } = deps;
  const form = new FormData();
  form.set("model", model);
  form.set("response_format", "json");
  form.set("file", new Blob([bytes as BlobPart], { type: mime }), `answer.${EXTENSION[mime] ?? "webm"}`);

  let response: Response;
  try {
    response = await fetchImpl(url, { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new TranscribeError(error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network");
  }
  if (!response.ok) throw new TranscribeError(response.status);
  const data = (await response.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof data?.text === "string" ? data.text.replace(/\s+/g, " ").trim() : "";
  if (!text) throw new TranscribeError("empty");
  return text.slice(0, MAX_TRANSCRIPT_CHARS);
}

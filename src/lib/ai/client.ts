export interface AiRequest {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens: number;
}

export interface AiResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiClient {
  complete(request: AiRequest): Promise<AiResponse>;
}

export const DEFAULT_INTERVIEWER_MODEL = "claude-haiku-4-5-20251001";

/** Thrown for any provider failure. Carries no response body, so nothing sensitive can leak into logs. */
export class AiError extends Error {
  constructor(readonly status: number | "network" | "timeout") {
    super(`AI request failed (${status})`);
  }
}

export function createAnthropicClient({
  apiKey,
  model = DEFAULT_INTERVIEWER_MODEL,
  fetchImpl = fetch,
  timeoutMs = 15_000,
}: {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): AiClient {
  return {
    async complete({ system, messages, maxTokens }) {
      let response: Response;
      try {
        response = await fetchImpl("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new AiError(error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network");
      }
      if (!response.ok) throw new AiError(response.status);

      const data = (await response.json().catch(() => null)) as {
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      } | null;
      const text = (data?.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
      return {
        text,
        inputTokens: Number(data?.usage?.input_tokens ?? 0),
        outputTokens: Number(data?.usage?.output_tokens ?? 0),
      };
    },
  };
}

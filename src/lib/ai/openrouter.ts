import { AiError, type AiClient } from "./client";

/**
 * TEST-ONLY provider: OpenRouter's OpenAI-style chat API, so the app can be tried with a free model.
 * Free models may log or train on what they receive, so use made-up answers only, and never in production
 * with real clients (see docs/ai-test-provider.md). The real provider is Anthropic.
 */
// A free model verified to follow the JSON-only prompts. Free models come and go: set OPENROUTER_MODEL to change it
// ("openrouter/free" lets OpenRouter pick any free model, but some of those print their reasoning into the answer).
export const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const REASONING_HEADROOM = 6000;

export function createOpenRouterClient({
  apiKey,
  model = DEFAULT_OPENROUTER_MODEL,
  fetchImpl = fetch,
  timeoutMs = 30_000,
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
        response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, "x-title": "Attract Studio (test)" },
          // Free models often "think" first, and that thinking counts against the limit: leave room for the answer itself.
          body: JSON.stringify({ model, max_tokens: maxTokens + REASONING_HEADROOM, reasoning: { effort: "low" }, messages: [{ role: "system", content: system }, ...messages] }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new AiError(error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network");
      }
      // Never include the body: it can echo the prompt, which holds a client's answers.
      if (!response.ok) throw new AiError(response.status);

      const data = (await response.json().catch(() => null)) as {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      } | null;
      const content = data?.choices?.[0]?.message?.content;
      return {
        text: typeof content === "string" ? content : "",
        inputTokens: Number(data?.usage?.prompt_tokens ?? 0),
        outputTokens: Number(data?.usage?.completion_tokens ?? 0),
      };
    },
  };
}

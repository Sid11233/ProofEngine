import { describe, expect, it } from "vitest";
import { AiError } from "./client";
import { createAiClient, aiConfigured } from "./factory";
import { createOpenRouterClient, DEFAULT_OPENROUTER_MODEL } from "./openrouter";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("createOpenRouterClient", () => {
  it("sends an OpenAI-style chat request with the system prompt first and the key as a bearer token", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = createOpenRouterClient({
      apiKey: "sk-or-test-key-123456789012345",
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return ok({ choices: [{ message: { content: "Hello there" } }], usage: { prompt_tokens: 12, completion_tokens: 3 } });
      }) as unknown as typeof fetch,
    });
    const result = await client.complete({ system: "SYS", messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Yo" }], maxTokens: 50 });
    expect(result).toEqual({ text: "Hello there", inputTokens: 12, outputTokens: 3 });
    expect(seen?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = seen?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-or-test-key-123456789012345");
    const body = JSON.parse(String(seen?.init.body));
    expect(body.model).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(body.max_tokens).toBe(50 + 6000);
    expect(body.messages).toEqual([{ role: "system", content: "SYS" }, { role: "user", content: "Hi" }, { role: "assistant", content: "Yo" }]);
  });

  it("throws an AiError without the response body, and tolerates odd answers", async () => {
    const failing = createOpenRouterClient({ apiKey: "k".repeat(30), fetchImpl: (async () => new Response("SECRET PROMPT ECHO", { status: 429 })) as unknown as typeof fetch });
    const error = await failing.complete({ system: "s", messages: [], maxTokens: 5 }).catch((e) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error.status).toBe(429);
    expect(String(error.message)).not.toContain("SECRET");

    const network = createOpenRouterClient({ apiKey: "k".repeat(30), fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
    expect(await network.complete({ system: "s", messages: [], maxTokens: 5 }).catch((e) => e.status)).toBe("network");

    const odd = createOpenRouterClient({ apiKey: "k".repeat(30), fetchImpl: (async () => ok({ choices: [{ message: { content: ["x"] } }] })) as unknown as typeof fetch });
    expect(await odd.complete({ system: "s", messages: [], maxTokens: 5 })).toEqual({ text: "", inputTokens: 0, outputTokens: 0 });
  });
});

describe("createAiClient", () => {
  it("uses Anthropic by default and only with a key", () => {
    expect(createAiClient({}, "interviewer")).toBeNull();
    expect(createAiClient({ ANTHROPIC_API_KEY: "a".repeat(30) }, "generator")).not.toBeNull();
    expect(aiConfigured({})).toBe(false);
    expect(aiConfigured({ ANTHROPIC_API_KEY: "a".repeat(30) })).toBe(true);
  });
  it("uses OpenRouter only when asked, and ignores the Anthropic key then", () => {
    expect(createAiClient({ AI_PROVIDER: "openrouter" }, "interviewer")).toBeNull();
    expect(aiConfigured({ AI_PROVIDER: "openrouter", ANTHROPIC_API_KEY: "a".repeat(30) })).toBe(false);
    expect(createAiClient({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "o".repeat(30) }, "generator")).not.toBeNull();
    expect(aiConfigured({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "o".repeat(30) })).toBe(true);
  });
});

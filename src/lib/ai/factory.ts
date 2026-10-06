import { createAnthropicClient, DEFAULT_INTERVIEWER_MODEL, type AiClient } from "./client";
import { createOpenRouterClient, DEFAULT_OPENROUTER_MODEL } from "./openrouter";

export const DEFAULT_GENERATOR_MODEL = "claude-sonnet-5-5";

export interface AiEnv {
  AI_PROVIDER?: "anthropic" | "openrouter";
  ANTHROPIC_API_KEY?: string;
  INTERVIEWER_MODEL?: string;
  GENERATOR_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
}

/**
 * The model client for one job, or null when no key is configured (the interview then uses canned lines and
 * generation answers "not configured"). Anthropic is the provider; OpenRouter exists only for testing and is
 * chosen explicitly with AI_PROVIDER=openrouter.
 */
let warned = false;

export function createAiClient(env: AiEnv, role: "interviewer" | "generator", { timeoutMs }: { timeoutMs?: number } = {}): AiClient | null {
  if (env.AI_PROVIDER === "openrouter") {
    if (!warned && process.env.NODE_ENV === "production") {
      warned = true;
      console.warn("AI_PROVIDER=openrouter is a TEST provider (free models, may log prompts). Do not use it with real clients.");
    }
    return env.OPENROUTER_API_KEY ? createOpenRouterClient({ apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL, timeoutMs }) : null;
  }
  if (!env.ANTHROPIC_API_KEY) return null;
  return createAnthropicClient({
    apiKey: env.ANTHROPIC_API_KEY,
    model: role === "interviewer" ? (env.INTERVIEWER_MODEL ?? DEFAULT_INTERVIEWER_MODEL) : (env.GENERATOR_MODEL ?? DEFAULT_GENERATOR_MODEL),
    timeoutMs,
  });
}

/** True when some provider is configured. */
export const aiConfigured = (env: AiEnv) => (env.AI_PROVIDER === "openrouter" ? Boolean(env.OPENROUTER_API_KEY) : Boolean(env.ANTHROPIC_API_KEY));

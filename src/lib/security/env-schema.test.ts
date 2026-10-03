import { describe, expect, it } from "vitest";
import { assertEnv } from "./env-schema";

const KEY_A = "a".repeat(40);
const KEY_B = "b".repeat(40);

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY_A,
  NEXT_PUBLIC_APP_URL: "https://app.example.com",
  SUPABASE_SERVICE_ROLE_KEY: KEY_B,
};

describe("assertEnv", () => {
  it("accepts a minimal valid environment", () => {
    const env = assertEnv(valid);
    expect(env.public.NEXT_PUBLIC_APP_URL).toBe("https://app.example.com");
    expect(env.server.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("fails when a required variable is missing, naming it", () => {
    const rest: Record<string, string | undefined> = { ...valid };
    delete rest.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => assertEnv(rest)).toThrow(/SUPABASE_SERVICE_ROLE_KEY \(server\)/);
  });

  it("treats blank values as missing", () => {
    expect(() => assertEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "" })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL \(public\)/,
    );
  });

  it("reports every problem at once", () => {
    expect(() => assertEnv({})).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL[\s\S]*SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("rejects the service role key in the anon slot", () => {
    expect(() =>
      assertEnv({ ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY_B }),
    ).toThrow(/must not equal SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("never includes secret values in the error message", () => {
    try {
      assertEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: "short-secret-value" });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("short-secret-value");
    }
  });

  it("validates optional variables when present", () => {
    expect(() => assertEnv({ ...valid, UPSTASH_REDIS_REST_URL: "not-a-url" })).toThrow(
      /UPSTASH_REDIS_REST_URL/,
    );
  });
});

import { describe, expect, it } from "vitest";
import { scrubDeep, scrubEvent, scrubString, scrubUrl, type ScrubbableEvent } from "./scrub";

const TOKEN = "Zk3p9XmQ2vL8nR4tY7uW1eA5sD6fG0hJ_-cBvNxMzLq"; // 43 chars, like our link tokens
const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ";
const SIGNED = `123e4567-e89b-42d3-a456-426614174000.${TOKEN}`;

describe("scrubString", () => {
  it("removes emails, JWTs, Stripe keys, bearer tokens, 43-char tokens, SHA-256 hashes, signed tokens and IPv4 addresses", () => {
    const hash = "a".repeat(64);
    const text = `user dana@example.com used ${JWT} and sk_live_abcdef123456 whsec_abcdef123456 Bearer abc.def.ghi-123 token ${TOKEN} hash ${hash} signed ${SIGNED} from 203.0.113.9`;
    const out = scrubString(text);
    for (const secret of ["dana@example.com", JWT, "sk_live_abcdef123456", "whsec_abcdef123456", "abc.def.ghi-123", TOKEN, hash, "203.0.113.9"]) expect(out, secret).not.toContain(secret);
    expect(out).toContain("[redacted]");
    expect(out).toContain("used");
  });

  it("redacts the token segment of every secret-link path", () => {
    for (const path of ["i", "preview", "approve", "unsubscribe", "remove", "invite"]) {
      const out = scrubString(`failed at /${path}/${TOKEN}/next`);
      expect(out, path).not.toContain(TOKEN);
      expect(out, path).toContain(`/${path}/[redacted]`);
    }
    expect(scrubString("short /i/abc")).toBe("short /i/[redacted]");
  });

  it("leaves ordinary text alone", () => {
    expect(scrubString("Cannot read properties of undefined (reading 'status')")).toBe("Cannot read properties of undefined (reading 'status')");
    expect(scrubString("claim_not_found 42501 at src/lib/x.ts:12")).toBe("claim_not_found 42501 at src/lib/x.ts:12");
  });
});

describe("scrubUrl", () => {
  it("keeps origin and path only, with no query, fragment, credentials or tokens", () => {
    expect(scrubUrl(`https://app.example.com/approve/${TOKEN}?email=a@b.co&x=1#frag`)).toBe("https://app.example.com/approve/[redacted]");
    expect(scrubUrl("https://user:pw@app.example.com/app/dashboard?token=abc")).toBe("https://app.example.com/app/dashboard");
    expect(scrubUrl(`/preview/${TOKEN}?a=1`)).toBe("/preview/[redacted]");
  });
});

describe("scrubDeep", () => {
  it("scrubs nested strings, bounds depth and size, and drops functions and symbols", () => {
    const out = scrubDeep({ a: { b: { c: [`mail me at x@y.zz`, 5, true, null, () => 1, Symbol("s")] } } }) as { a: { b: { c: unknown[] } } };
    expect(out.a.b.c.slice(0, 4)).toEqual(["mail me at [redacted]", 5, true, null]);
    let deep: Record<string, unknown> = { leak: "x@y.zz" };
    for (let i = 0; i < 20; i++) deep = { next: deep };
    expect(JSON.stringify(scrubDeep(deep))).not.toContain("x@y.zz");
    expect((scrubDeep(Array.from({ length: 500 }, (_, i) => i)) as unknown[]).length).toBe(50);
  });
});

describe("scrubEvent", () => {
  const event = (): ScrubbableEvent => ({
    message: `Failed for dana@example.com with ${TOKEN}`,
    transaction: `GET /i/${TOKEN}`,
    server_name: "ip-10-0-0-1",
    user: { id: "u1", email: "dana@example.com", ip_address: "203.0.113.9" },
    request: {
      url: `https://app.example.com/i/${TOKEN}?utm=1`,
      method: "POST",
      data: { answer: "We cut costs by 40 percent" },
      cookies: { "sb-access-token": JWT },
      headers: { cookie: `sb=${JWT}`, authorization: "Bearer abc.def.ghi-123", "x-forwarded-for": "203.0.113.9", "user-agent": "Mozilla" },
      query_string: "email=dana@example.com",
      env: { REMOTE_ADDR: "203.0.113.9" },
    },
    exception: { values: [{ type: "Error", value: `bad ${SIGNED}`, stacktrace: { frames: [{ filename: "app.js", vars: { password: "hunter2", email: "d@e.fr" } }] } }] },
    breadcrumbs: [{ message: `GET /approve/${TOKEN}` }],
    extra: { transcript: "secret answer" },
    contexts: { runtime: { name: "node" }, custom: { note: "dana@example.com" }, os: { name: "Linux" } },
    tags: { signal: "failed_login", who: "dana@example.com" },
  });

  it("removes the request body, cookies, headers, query string, user, server name, breadcrumbs, extras and local variables", () => {
    const out = scrubEvent(event());
    expect(out.request).toEqual({ url: "https://app.example.com/i/[redacted]", method: "POST" });
    expect(out.user).toBeUndefined();
    expect(out.server_name).toBeUndefined();
    expect(out.breadcrumbs).toBeUndefined();
    expect(out.extra).toBeUndefined();
    expect(out.exception?.values?.[0].stacktrace?.frames?.[0].vars).toBeUndefined();
    expect(Object.keys(out.contexts ?? {}).sort()).toEqual(["os", "runtime"]);
  });

  it("leaves nothing secret-looking anywhere in the serialised event", () => {
    const json = JSON.stringify(scrubEvent(event()));
    for (const secret of [TOKEN, JWT, SIGNED, "dana@example.com", "203.0.113.9", "hunter2", "We cut costs", "secret answer", "Bearer", "d@e.fr", "ip-10-0-0-1"]) {
      expect(json.includes(secret), `the event still contains ${secret}`).toBe(false);
    }
    expect(json).toContain("failed_login");
  });

  it("copes with a bare event", () => {
    expect(scrubEvent({} as ScrubbableEvent)).toEqual({});
    expect(scrubEvent({ message: "x" })).toEqual({ message: "x" });
  });
});

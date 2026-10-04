import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createResolver, firstName } from "./interview-access-core";
import { createMemoryLimiter } from "@/lib/security/rate-limit-memory";
import { generateToken, hashToken } from "@/lib/security/tokens";

type Tables = Record<string, unknown>;

/** A chainable stand-in for the Supabase query builder: any method returns itself; single/maybeSingle resolve the table's row. */
function stubAdmin(tables: Tables, onQuery?: (table: string) => void): SupabaseClient {
  return {
    from(table: string) {
      onQuery?.(table);
      const chain: unknown = new Proxy(() => undefined, {
        get: (_t, prop) =>
          prop === "maybeSingle" || prop === "single"
            ? () => Promise.resolve({ data: tables[table] ?? null, error: null })
            : () => chain,
      });
      return chain;
    },
  } as unknown as SupabaseClient;
}

const limiter = (limit = 1000) => createMemoryLimiter({ limit, windowMs: 60_000 });
const future = () => new Date(Date.now() + 86_400_000).toISOString();

function fixture(overrides: Record<string, unknown> = {}, token = generateToken()) {
  const request = {
    id: "req-1",
    workspace_id: "ws-1",
    client_name: "  Casey   Jones ",
    flow_type: "agency",
    token_hash: token.hash,
    status: "sent",
    expires_at: future(),
    revoked_at: null,
    ...overrides,
  };
  const tables: Tables = {
    proof_requests: request,
    workspaces: { name: "Acme" },
    interviews: null,
    question_flows: { questions: [{ id: "q1", text: "What did {{workspace}} do?" }] },
  };
  return { token, tables };
}

const resolverFor = (tables: Tables, extra: Partial<Parameters<typeof createResolver>[0]> = {}) =>
  createResolver({ admin: stubAdmin(tables), ipLimiter: limiter(), tokenLimiter: limiter(), ...extra });

describe("resolveInterview", () => {
  it("returns only the minimal view for a valid link", async () => {
    const { token, tables } = fixture();
    const result = await resolverFor(tables)(token.raw, { ip: "ip" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.access.view).toEqual({
      workspaceName: "Acme",
      clientFirstName: "Casey",
      questions: [{ id: "q1", text: "What did Acme do?" }],
      consentVersion: expect.any(String),
    });
    // Nothing about the client's email, other interviews or members can leak through the view.
    expect(JSON.stringify(result.access.view)).not.toMatch(/email|ws-1|req-1/);
  });

  it.each([
    ["revoked", { revoked_at: new Date().toISOString() }],
    ["expired", { expires_at: new Date(Date.now() - 1000).toISOString() }],
    ["completed", { status: "completed" }],
    ["status revoked", { status: "revoked" }],
    ["status expired", { status: "expired" }],
  ])("rejects a %s link with the generic result", async (_label, overrides) => {
    const { token, tables } = fixture(overrides);
    expect(await resolverFor(tables)(token.raw, { ip: "ip" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("gives identical results for invalid, expired and revoked links", async () => {
    const results = await Promise.all([
      resolverFor(fixture({ revoked_at: new Date().toISOString() }).tables)(fixture().token.raw, { ip: "a" }),
      resolverFor(fixture({ expires_at: new Date(0).toISOString() }).tables)(fixture().token.raw, { ip: "b" }),
      resolverFor({ proof_requests: null })(generateToken().raw, { ip: "c" }),
      resolverFor({})("garbage", { ip: "d" }),
    ]);
    for (const r of results) expect(r).toEqual(results[0]);
  });

  it("rejects a row whose stored hash differs from the token's hash", async () => {
    const { token, tables } = fixture({ token_hash: hashToken("some other token") });
    expect(await resolverFor(tables)(token.raw, { ip: "ip" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("never touches the database for a malformed token", async () => {
    const onQuery = vi.fn();
    const resolve = createResolver({ admin: stubAdmin({}, onQuery), ipLimiter: limiter(), tokenLimiter: limiter() });
    for (const bad of ["", "short", "../../etc/passwd", "a".repeat(44), "a".repeat(42) + "!"]) {
      expect((await resolve(bad, { ip: "ip" })).ok).toBe(false);
    }
    expect(onQuery).not.toHaveBeenCalled();
  });

  it("fails closed when the question flow is missing or empty", async () => {
    const { token, tables } = fixture();
    expect(await resolverFor({ ...tables, question_flows: null })(token.raw, { ip: "ip" })).toEqual({ ok: false, reason: "not_found" });
    expect(await resolverFor({ ...tables, question_flows: { questions: [] } })(token.raw, { ip: "ip" })).toEqual({ ok: false, reason: "not_found" });
    expect(await resolverFor({ ...tables, workspaces: null })(token.raw, { ip: "ip" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("rate limits by IP (30/min in production) before looking anything up, valid or not", async () => {
    const { token, tables } = fixture();
    const resolve = resolverFor(tables, { ipLimiter: limiter(3) });
    for (let i = 0; i < 3; i++) expect((await resolve("garbage", { ip: "same" })).ok).toBe(false);
    expect(await resolve(token.raw, { ip: "same" })).toEqual({ ok: false, reason: "rate_limited" });
    expect((await resolve(token.raw, { ip: "other" })).ok).toBe(true);
  });

  it("rate limits by token (60/min in production)", async () => {
    const { token, tables } = fixture();
    const resolve = resolverFor(tables, { tokenLimiter: limiter(2) });
    expect((await resolve(token.raw, { ip: "1" })).ok).toBe(true);
    expect((await resolve(token.raw, { ip: "2" })).ok).toBe(true);
    expect(await resolve(token.raw, { ip: "3" })).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("uses the injected clock for expiry", async () => {
    const { token, tables } = fixture();
    const farFuture = Date.now() + 365 * 86_400_000;
    expect(await resolverFor(tables, { now: () => farFuture })(token.raw, { ip: "ip" })).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("firstName", () => {
  it.each([
    ["Casey Jones", "Casey"],
    ["  Casey   Jones ", "Casey"],
    ["Cher", "Cher"],
    ["", "there"],
    ["   ", "there"],
    ["x".repeat(200), "x".repeat(50)],
  ])("%j -> %j", (input, expected) => expect(firstName(input)).toBe(expected));
});

import { describe, expect, it } from "vitest";
import { createMemoryLimiter } from "@/lib/security/rate-limit-memory";
import { createSignals, SIGNAL_RULES, type Alert, type Signal } from "./signals-core";

function setup(rules = SIGNAL_RULES) {
  const alerts: Alert[] = [];
  let now = 1_000_000;
  const signals = createSignals({
    limiter: (_prefix, limit, windowSec) => createMemoryLimiter({ limit, windowMs: windowSec * 1000, now: () => now }),
    notify: async (a) => void alerts.push(a),
    rules,
  });
  return { signals, alerts, advance: (ms: number) => (now += ms) };
}

describe("signals", () => {
  it("stays quiet up to the threshold, alerts on the next event, and then only once per cooldown", async () => {
    const { signals, alerts, advance } = setup();
    const rule = SIGNAL_RULES.failed_login;
    for (let i = 0; i < rule.threshold; i++) expect(await signals.record("failed_login")).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(await signals.record("failed_login")).toBe(true);
    expect(alerts).toEqual([{ signal: "failed_login", label: rule.label, count: rule.threshold + 1, windowMinutes: 10 }]);
    for (let i = 0; i < 100; i++) expect(await signals.record("failed_login")).toBe(false);
    expect(alerts).toHaveLength(1);
    // After the cooldown a new burst alerts again.
    advance(rule.cooldownSec * 1000 + 1000);
    for (let i = 0; i <= rule.threshold; i++) await signals.record("failed_login");
    expect(alerts).toHaveLength(2);
  });

  it("does not alert for a slow trickle: the window forgets old events", async () => {
    const { signals, alerts, advance } = setup();
    for (let i = 0; i < 200; i++) {
      await signals.record("interview_token_miss");
      advance(30_000); // two a minute, far below 60 per 10 minutes
    }
    expect(alerts).toHaveLength(0);
  });

  it("alerts on the very first event for the AI spend limit, once a day", async () => {
    const { signals, alerts, advance } = setup();
    expect(await signals.record("ai_spend_limit")).toBe(true);
    expect(await signals.record("ai_spend_limit")).toBe(false);
    advance(3_600_000);
    expect(await signals.record("ai_spend_limit")).toBe(false);
    advance(24 * 3_600_000);
    expect(await signals.record("ai_spend_limit")).toBe(true);
    expect(alerts.map((a) => a.signal)).toEqual(["ai_spend_limit", "ai_spend_limit"]);
  });

  it("keeps each signal separate", async () => {
    const { signals, alerts } = setup();
    for (let i = 0; i <= SIGNAL_RULES.webhook_failure.threshold; i++) await signals.record("webhook_failure");
    expect(alerts.map((a) => a.signal)).toEqual(["webhook_failure"]);
  });

  it("never throws, even if the notifier or limiter does", async () => {
    const boom = createSignals({ limiter: () => { throw new Error("redis down"); }, notify: async () => undefined });
    await expect(boom.record("failed_login")).resolves.toBe(false);
    const rules = { ...SIGNAL_RULES, permission_error: { ...SIGNAL_RULES.permission_error, threshold: 0 } };
    const failing = createSignals({ limiter: (_p, limit, windowSec) => createMemoryLimiter({ limit, windowMs: windowSec * 1000 }), notify: async () => { throw new Error("mail down"); }, rules });
    await expect(failing.record("permission_error")).resolves.toBe(false);
  });

  it("alerts carry only the signal name, a label and counts: nothing about a person", async () => {
    const { signals, alerts } = setup();
    for (const s of Object.keys(SIGNAL_RULES) as Signal[]) for (let i = 0; i <= SIGNAL_RULES[s].threshold; i++) await signals.record(s);
    for (const a of alerts) expect(Object.keys(a).sort()).toEqual(["count", "label", "signal", "windowMinutes"]);
    expect(alerts).toHaveLength(Object.keys(SIGNAL_RULES).length);
  });
});

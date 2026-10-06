import type { RateLimiter } from "@/lib/security/rate-limit-memory";

// Security signals: counts of things that are normal in small numbers and a sign of trouble in large ones
// (failed logins, unknown interview tokens, webhook failures, permission errors, the AI spend limit). When a
// count passes its threshold inside the window we send ONE alert per cooldown. The alert says what and how
// much, never who: no email, token, id or content is ever part of a signal.

export type Signal = "failed_login" | "interview_token_miss" | "webhook_failure" | "webhook_bad_signature" | "permission_error" | "ai_spend_limit";

export interface SignalRule {
  /** Events allowed inside the window before an alert fires (the next one fires it). */
  threshold: number;
  windowSec: number;
  /** At most one alert per signal in this time. */
  cooldownSec: number;
  label: string;
}

export const SIGNAL_RULES: Record<Signal, SignalRule> = {
  failed_login: { threshold: 30, windowSec: 600, cooldownSec: 3600, label: "Spike in failed sign-ins" },
  interview_token_miss: { threshold: 60, windowSec: 600, cooldownSec: 3600, label: "Spike in unknown interview links (possible link guessing)" },
  webhook_failure: { threshold: 2, windowSec: 600, cooldownSec: 3600, label: "Stripe webhook handling is failing" },
  webhook_bad_signature: { threshold: 20, windowSec: 600, cooldownSec: 3600, label: "Spike in Stripe webhook requests with a bad signature" },
  permission_error: { threshold: 50, windowSec: 600, cooldownSec: 3600, label: "Spike in permission (RLS) errors from the database" },
  // Fires on the first event: the daily AI spend limit was reached and interviews are paused.
  ai_spend_limit: { threshold: 0, windowSec: 600, cooldownSec: 86_400, label: "Daily AI spend limit reached: interviews are paused" },
};

export interface Alert {
  signal: Signal;
  label: string;
  /** Events counted in the window when the alert fired. */
  count: number;
  windowMinutes: number;
}

export interface SignalDeps {
  /** A limiter that allows `limit` calls per `windowSec` per identifier. */
  limiter(prefix: string, limit: number, windowSec: number): RateLimiter;
  notify(alert: Alert): Promise<void>;
  rules?: Record<Signal, SignalRule>;
}

export function createSignals({ limiter, notify, rules = SIGNAL_RULES }: SignalDeps) {
  const counters = new Map<Signal, RateLimiter>();
  const cooldowns = new Map<Signal, RateLimiter>();

  return {
    /** Counts one event. Never throws; an alert is sent at most once per cooldown. Returns whether it alerted. */
    async record(signal: Signal): Promise<boolean> {
      try {
        const rule = rules[signal];
        if (!cooldowns.has(signal)) {
          // A limiter that tolerates `threshold` events: the next one is "over the limit", which is the alert.
          if (rule.threshold > 0) counters.set(signal, limiter(`signal:${signal}`, rule.threshold, rule.windowSec));
          cooldowns.set(signal, limiter(`signal-cooldown:${signal}`, 1, rule.cooldownSec));
        }
        const counter = counters.get(signal);
        const over = counter ? !(await counter.limit("all")).success : true;
        if (!over) return false;
        // The limiter lets one call through per cooldown: that call sends the alert, the rest stay quiet.
        if (!(await cooldowns.get(signal)!.limit("all")).success) return false;
        await notify({ signal, label: rule.label, count: rule.threshold + 1, windowMinutes: Math.round(rule.windowSec / 60) });
        return true;
      } catch {
        return false;
      }
    },
  };
}

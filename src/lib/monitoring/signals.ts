import "server-only";
import * as Sentry from "@sentry/nextjs";
import { getEmailSender } from "@/lib/email/resend";
import { serverEnv } from "@/lib/security/env.server";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { createSignals, type Alert, type Signal } from "./signals-core";

// Where alerts go: a Sentry message tagged `signal` (create an alert rule on that tag, see docs/monitoring.md)
// and, if ALERT_EMAIL and Resend are configured, a short plain-text email. Counts are shared across
// serverless instances through Upstash when it is configured (otherwise per instance).

async function notify(alert: Alert): Promise<void> {
  Sentry.captureMessage(`Security signal: ${alert.label}`, { level: "warning", tags: { signal: alert.signal } });
  const to = serverEnv.ALERT_EMAIL;
  const sender = getEmailSender();
  if (to && sender) {
    await sender.send({
      to,
      subject: `Alert: ${alert.label}`,
      text: [`${alert.label}.`, "", `More than ${alert.count - 1} events in ${alert.windowMinutes} minutes (signal: ${alert.signal}).`, "", "Open the incident response guide (docs/incident-response.md) and the Sentry issue tagged with this signal. No personal data is included in this message."].join("\n"),
    });
  }
}

const signals = createSignals({ limiter: (prefix, limit, windowSec) => createRateLimiter({ prefix, limit, windowSec }), notify });

/** Counts a security signal and alerts when it passes its threshold. Safe to call anywhere; never throws. */
export const recordSignal = (signal: Signal): Promise<boolean> => signals.record(signal);

/** For fire-and-forget call sites. */
export function signal(name: Signal): void {
  void recordSignal(name).catch(() => false);
}

/** Reports an error that was caught and handled but should still be looked at. Scrubbed before it leaves. */
export function reportError(error: unknown, tag: string): void {
  Sentry.captureException(error instanceof Error ? error : new Error(String(error)), { tags: { area: tag } });
}

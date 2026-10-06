import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/monitoring/sentry-options";

// Runs once when the server starts. Without SENTRY_DSN nothing is initialised and no data leaves the app.
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || process.env.NEXT_RUNTIME !== "nodejs") return;
  Sentry.init(sentryOptions(dsn, process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "production"));

  // Lets code that must stay free of server-only imports (the pure error classifier) report a signal.
  const { recordSignal } = await import("@/lib/monitoring/signals");
  (globalThis as { __peSignal?: (name: string) => void }).__peSignal = (name) => void recordSignal(name as Parameters<typeof recordSignal>[0]);
}

// Errors thrown while rendering or handling a request. Scrubbed by beforeSend before they leave.
export const onRequestError = Sentry.captureRequestError;

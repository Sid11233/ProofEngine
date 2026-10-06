import type { ErrorEvent, NodeOptions } from "@sentry/nextjs";
import { scrubEvent, type ScrubbableEvent } from "./scrub";

// The one place Sentry is configured. Server side only: there is no browser SDK, so no script is added to
// any page, the interview page stays light, and nothing a visitor types can be captured in the browser.

export function sentryOptions(dsn: string, environment: string): NodeOptions {
  return {
    dsn,
    environment,
    // Collect nothing personal at the source (scrubEvent then removes whatever still slips through).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    // Errors only: no performance traces, no profiling, no breadcrumbs (they carry URLs and console output).
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    // Keep a burst of one failure from using up the monthly quota.
    sampleRate: 1,
    ignoreErrors: ["NEXT_REDIRECT", "NEXT_NOT_FOUND", "NEXT_HTTP_ERROR_FALLBACK"],
    beforeSend: (event: ErrorEvent) => scrubEvent(event as unknown as ScrubbableEvent) as unknown as ErrorEvent,
    // Free-form capture is switched off; the request details the SDK attaches are removed again in scrubEvent.
    integrations: (defaults) => defaults.filter((i) => i.name !== "Console" && i.name !== "LocalVariables"),
  };
}

import * as Sentry from "@sentry/nextjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sentryOptions } from "./sentry-options";

// The REAL Sentry SDK with the production options and a transport that keeps what would have been sent, so
// this proves what actually leaves the server, not just what our scrub function does in isolation.

const TOKEN = "Zk3p9XmQ2vL8nR4tY7uW1eA5sD6fG0hJ_-cBvNxMzLq";
const sent: string[] = [];

beforeAll(() => {
  Sentry.init({
    ...sentryOptions("https://publickey@o0.ingest.sentry.io/1", "test"),
    transport: () => ({
      send: async (envelope: unknown) => {
        sent.push(JSON.stringify(envelope));
        return {};
      },
      flush: async () => true,
    }),
  });
});
afterAll(async () => {
  await Sentry.close(1000);
});

describe("what Sentry would send", () => {
  it("is an error report with no body, cookies, headers, user, extras, breadcrumbs or secrets", async () => {
    sent.length = 0;
    Sentry.addBreadcrumb({ message: `GET /i/${TOKEN}`, category: "http" });
    Sentry.withScope((scope) => {
      scope.setUser({ id: "u-1", email: "dana@example.com", ip_address: "203.0.113.9" });
      scope.setExtra("transcript", "We cut costs by 40 percent");
      scope.setTag("area", "test");
      scope.setSDKProcessingMetadata({
        normalizedRequest: {
          url: `https://app.example.com/i/${TOKEN}?email=dana@example.com`,
          method: "POST",
          headers: { cookie: "sb-access-token=SECRETCOOKIEVALUE", authorization: "Bearer SECRETBEARERVALUE", "x-forwarded-for": "203.0.113.9" },
          cookies: { "sb-access-token": "SECRETCOOKIEVALUE" },
          data: { answer: "SECRET INTERVIEW ANSWER" },
          query_string: "email=dana@example.com",
        },
      });
      Sentry.captureException(new Error(`Could not save the answer of dana@example.com (token ${TOKEN})`));
    });
    await Sentry.flush(2000);

    expect(sent.length, "no event was produced").toBeGreaterThan(0);
    const payload = sent.join("\n");
    for (const secret of ["SECRETCOOKIEVALUE", "SECRETBEARERVALUE", "SECRET INTERVIEW ANSWER", "dana@example.com", TOKEN, "203.0.113.9", "We cut costs", "u-1"]) {
      expect(payload.includes(secret), `Sentry would have received: ${secret}`).toBe(false);
    }
    // The useful part is still there.
    expect(payload).toContain("Could not save the answer of");
    expect(payload).toContain("app.example.com/i/[redacted]");
  });

  it("reports security signals as tagged messages with no personal data", async () => {
    sent.length = 0;
    Sentry.captureMessage("Security signal: Spike in failed sign-ins", { level: "warning", tags: { signal: "failed_login" } });
    await Sentry.flush(2000);
    expect(sent.join("\n")).toContain("failed_login");
  });

  it("does not send control-flow errors (redirects and not-found) at all", async () => {
    sent.length = 0;
    Sentry.captureException(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }));
    Sentry.captureException(new Error("NEXT_NOT_FOUND"));
    await Sentry.flush(2000);
    expect(sent.join("\n")).not.toContain("NEXT_REDIRECT");
    expect(sent.join("\n")).not.toContain("NEXT_NOT_FOUND");
  });
});

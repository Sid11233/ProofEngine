import { describe, expect, it } from "vitest";
import { isProtectedPath, needsSession, resolveAuthRedirect, safeNextPath } from "./redirects";

describe("resolveAuthRedirect", () => {
  const anonymous = { isAuthenticated: false, mfaPending: false };
  const signedIn = { isAuthenticated: true, mfaPending: false };
  const needsMfa = { isAuthenticated: true, mfaPending: true };

  it.each(["/app", "/app/dashboard", "/app/settings/team", "/onboarding", "/invite/abc"])(
    "sends an anonymous visitor on %s to login, remembering where they were going",
    (pathname) => {
      expect(resolveAuthRedirect({ pathname, ...anonymous })).toBe(`/login?next=${encodeURIComponent(pathname)}`);
    },
  );

  it("keeps the query string in the remembered destination", () => {
    expect(resolveAuthRedirect({ pathname: "/app/requests", search: "?tab=sent", ...anonymous })).toBe(
      `/login?next=${encodeURIComponent("/app/requests?tab=sent")}`,
    );
  });

  it("lets a signed-in user through to protected pages", () => {
    expect(resolveAuthRedirect({ pathname: "/app/dashboard", ...signedIn })).toBeNull();
  });

  it("sends a user who still owes the second factor to the MFA step", () => {
    expect(resolveAuthRedirect({ pathname: "/app/dashboard", ...needsMfa })).toBe(
      `/login/mfa?next=${encodeURIComponent("/app/dashboard")}`,
    );
  });

  it("does not trap the MFA page itself", () => {
    expect(resolveAuthRedirect({ pathname: "/login/mfa", ...needsMfa })).toBeNull();
    expect(resolveAuthRedirect({ pathname: "/login/mfa", ...anonymous })).toBe("/login");
    expect(resolveAuthRedirect({ pathname: "/login/mfa", ...signedIn })).toBe("/app/dashboard");
  });

  it.each(["/login", "/signup", "/forgot-password"])("bounces a signed-in user away from %s", (pathname) => {
    expect(resolveAuthRedirect({ pathname, ...signedIn })).toBe("/app/dashboard");
    expect(resolveAuthRedirect({ pathname, ...anonymous })).toBeNull();
  });

  it("leaves public pages alone", () => {
    for (const pathname of ["/", "/pricing", "/auth/callback", "/reset-password"]) {
      expect(resolveAuthRedirect({ pathname, ...anonymous })).toBeNull();
    }
  });

  it("does not treat look-alike prefixes as protected", () => {
    expect(isProtectedPath("/application")).toBe(false);
    expect(isProtectedPath("/app-store")).toBe(false);
    expect(isProtectedPath("/onboarding-tips")).toBe(false);
    expect(resolveAuthRedirect({ pathname: "/application", ...anonymous })).toBeNull();
  });

  it("only asks middleware for a session where one matters", () => {
    expect(needsSession("/")).toBe(false);
    expect(needsSession("/app/dashboard")).toBe(true);
    expect(needsSession("/login")).toBe(true);
    expect(needsSession("/login/mfa")).toBe(true);
  });
});

describe("safeNextPath (open redirect protection)", () => {
  it("accepts same-site relative paths", () => {
    expect(safeNextPath("/app/settings/team")).toBe("/app/settings/team");
    expect(safeNextPath("/invite/abc123?x=1")).toBe("/invite/abc123?x=1");
  });

  it.each([
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "http://evil.com/app",
    "javascript:alert(1)",
    "data:text/html,<script>",
    "evil.com",
    "app/dashboard",
    "/app\r\nSet-Cookie: x=1",
    "/app\tevil",
    "/\u0000evil",
    `/${"a".repeat(600)}`,
    "",
  ])("rejects %j", (value) => {
    expect(safeNextPath(value)).toBe("/app/dashboard");
  });

  it("falls back when nothing is given, and honours a custom fallback", () => {
    expect(safeNextPath(null)).toBe("/app/dashboard");
    expect(safeNextPath(undefined, "/onboarding")).toBe("/onboarding");
  });
});

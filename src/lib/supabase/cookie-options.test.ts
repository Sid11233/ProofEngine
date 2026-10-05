import { describe, expect, it } from "vitest";
import { hardenCookie } from "./cookie-options";

describe("hardenCookie", () => {
  it("makes session cookies HttpOnly and SameSite=Lax, whatever the library asked for", () => {
    const out = hardenCookie({ httpOnly: false, sameSite: "none", maxAge: 400, path: "/" }, false);
    expect(out).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 400, path: "/" });
  });

  it("is Secure in production and not on plain-http local development", () => {
    expect(hardenCookie({}, true).secure).toBe(true);
    expect(hardenCookie({}, false).secure).toBe(false);
  });

  it("keeps expiry and defaults the path", () => {
    const expires = new Date(0);
    expect(hardenCookie({ expires }, true)).toMatchObject({ expires, path: "/" });
    expect(hardenCookie(undefined, true)).toMatchObject({ httpOnly: true, path: "/" });
  });
});

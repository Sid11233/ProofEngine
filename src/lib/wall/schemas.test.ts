import { describe, expect, it } from "vitest";
import { normaliseOrigin, parseOrigins, wallSettingsSchema } from "./schemas";

describe("normaliseOrigin", () => {
  it("keeps plain https origins and drops case and a trailing slash", () => {
    expect(normaliseOrigin("https://Example.com")).toBe("https://example.com");
    expect(normaliseOrigin("https://www.example.com/")).toBe("https://www.example.com");
    expect(normaliseOrigin("https://example.com:8443")).toBe("https://example.com:8443");
  });
  it("rejects everything that could widen the allowlist or smuggle CSP syntax", () => {
    for (const bad of [
      "http://example.com", "https://*.example.com", "*", "https://example.com/path", "https://example.com?x=1",
      "https://user:pw@example.com", "https://example.com; script-src *", "https://a.com https://b.com", "https://localhost",
      "javascript:alert(1)", "https://exa mple.com", "'self'", "data:", "", "https://" + "a".repeat(300) + ".com",
    ]) {
      expect(normaliseOrigin(bad), bad).toBeNull();
    }
  });
});

describe("parseOrigins", () => {
  it("parses lines, removes duplicates and reports the first bad line", () => {
    expect(parseOrigins("https://a.com\n\nhttps://A.com/\nhttps://b.org")).toEqual({ ok: true, origins: ["https://a.com", "https://b.org"] });
    expect(parseOrigins("https://a.com\nhttp://b.org")).toEqual({ ok: false, bad: "http://b.org" });
  });
});

describe("wallSettingsSchema", () => {
  const ok = { enabled: true, origins: ["https://a.com"], layout: "grid", maxItems: 6 };
  it("accepts good settings and requires a site when enabled", () => {
    expect(wallSettingsSchema.safeParse(ok).success).toBe(true);
    expect(wallSettingsSchema.safeParse({ ...ok, origins: [] }).success).toBe(false);
    expect(wallSettingsSchema.safeParse({ ...ok, enabled: false, origins: [] }).success).toBe(true);
  });
  it("rejects unknown fields and out-of-range values", () => {
    expect(wallSettingsSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(wallSettingsSchema.safeParse({ ...ok, maxItems: 99 }).success).toBe(false);
    expect(wallSettingsSchema.safeParse({ ...ok, layout: "masonry" }).success).toBe(false);
  });
});

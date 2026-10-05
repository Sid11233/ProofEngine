import { describe, expect, it } from "vitest";
import { createDeduper } from "./dedupe";
import { eventSchema, referrerHost } from "./schemas";

const visitor = { ip: "203.0.113.5", userAgent: "UA", page: "acme/story", type: "view" };

describe("createDeduper", () => {
  it("counts a visitor once per page and type per day", () => {
    const d = createDeduper();
    expect(d.firstTime(visitor)).toBe(true);
    expect(d.firstTime(visitor)).toBe(false);
    expect(d.firstTime({ ...visitor, type: "cta_click" })).toBe(true);
    expect(d.firstTime({ ...visitor, page: "acme/other" })).toBe(true);
    expect(d.firstTime({ ...visitor, ip: "203.0.113.6" })).toBe(true);
  });

  it("forgets everything when the UTC day changes (the salt is replaced)", () => {
    let now = Date.parse("2026-10-05T23:00:00Z");
    const d = createDeduper({ now: () => now });
    expect(d.firstTime(visitor)).toBe(true);
    expect(d.firstTime(visitor)).toBe(false);
    now = Date.parse("2026-10-06T00:30:00Z");
    expect(d.firstTime(visitor), "a visitor was recognised across days").toBe(true);
  });

  it("is bounded: when memory is full it resets instead of growing", () => {
    const d = createDeduper({ maxEntries: 3 });
    for (let i = 0; i < 3; i++) d.firstTime({ ...visitor, ip: `10.0.0.${i}` });
    expect(d.firstTime({ ...visitor, ip: "10.0.0.0" })).toBe(true);
  });
});

describe("referrerHost", () => {
  it("keeps only a lower-case hostname", () => {
    expect(referrerHost("https://News.Example.com/path?q=secret#frag")).toBe("news.example.com");
    expect(referrerHost("http://example.org:8080/x")).toBe("example.org");
  });
  it("drops everything that is not a plain http(s) URL", () => {
    for (const bad of ["", undefined, null, "javascript:alert(1)", "data:text/html,x", "not a url", "ftp://example.com", "https://" + "a".repeat(300) + ".com/x"]) {
      expect(referrerHost(bad as string), String(bad)).toBeNull();
    }
  });
});

describe("eventSchema", () => {
  it("accepts the three event types and nothing else", () => {
    for (const type of ["view", "cta_click", "referral_click"]) expect(eventSchema.safeParse({ type }).success).toBe(true);
    for (const bad of [{ type: "purchase" }, { type: "view", ip: "1.2.3.4" }, { type: "view", userAgent: "x" }, {}, { type: "view", referrer: "x".repeat(3000) }]) {
      expect(eventSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 50)).toBe(false);
    }
  });
});

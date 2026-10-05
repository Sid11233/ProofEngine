import { describe, expect, it } from "vitest";
import { isSitesPath, publicPageUrl, siteSubdomain } from "./host";

describe("siteSubdomain", () => {
  it("returns the workspace label for hosts under the sites domain", () => {
    expect(siteSubdomain("acme.pages.example", "pages.example")).toBe("acme");
    expect(siteSubdomain("Acme.Pages.Example", "pages.example")).toBe("acme");
    expect(siteSubdomain("acme.localhost:3111", "localhost:3111")).toBe("acme");
  });
  it("is null for the app host, the bare domain, nested labels and bad labels", () => {
    for (const host of ["app.example.com", "pages.example", "a.b.pages.example", "-bad.pages.example", "x.pages.example", "acme.pages.example.evil.com", "", null, undefined]) {
      expect(siteSubdomain(host, "pages.example"), String(host)).toBeNull();
    }
  });
  it("is null when no sites domain is configured", () => {
    expect(siteSubdomain("acme.pages.example", undefined)).toBeNull();
  });
});

describe("helpers", () => {
  it("detects the internal path and builds public URLs", () => {
    expect(isSitesPath("/sites/acme/story")).toBe(true);
    expect(isSitesPath("/sitesx")).toBe(false);
    expect(publicPageUrl("pages.example", "acme", "story", true)).toBe("https://acme.pages.example/story");
  });
});

import { describe, expect, it } from "vitest";
import { embedCsp, esc, renderWall, safeHref } from "./embed-html";

describe("esc and safeHref", () => {
  it("escapes every character that can break out of text or an attribute", () => {
    expect(esc(`<script>"a" & 'b' \`c\`</script>`)).toBe("&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39; &#96;c&#96;&lt;/script&gt;");
  });
  it("allows only plain http(s) links", () => {
    expect(safeHref("https://a.example/x-y")).toBe("https://a.example/x-y");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", '"onmouseover="x', "https://a.com/\"><script>", "//evil.com", " https://a.com"]) expect(safeHref(bad), bad).toBe("#");
  });
});

describe("renderWall", () => {
  const page = {
    workspaceName: "Acme <b>Studio</b>",
    layout: "grid" as const,
    items: [{ headline: 'Big win "x" <script>alert(1)</script>', clientName: "Dana & Co", href: "https://acme.pages.example/big-win" }],
    badge: { href: "https://app.example.com", name: "Proof Engine" },
  };
  it("escapes all text and contains no script", () => {
    const html = renderWall(page);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("<b>Studio");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Dana &amp; Co");
    expect(html).toContain('target="_top"');
  });
  it("neutralises a hostile link and leaves out the badge when there is none", () => {
    expect(renderWall({ ...page, items: [{ ...page.items[0], href: "javascript:alert(1)" }] })).toContain('href="#"');
    expect(renderWall({ ...page, badge: null })).not.toContain("Powered by");
  });
});

describe("embedCsp", () => {
  it("allows framing only by the listed origins and nothing else", () => {
    const csp = embedCsp(["https://a.com", "https://b.org:8443"]);
    expect(csp).toContain("frame-ancestors https://a.com https://b.org:8443");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/script-src|connect-src/);
    expect(embedCsp([])).toContain("frame-ancestors 'none'");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/font only works inside Next.js; the renderer only needs the class and variable names.
vi.mock("@/lib/case-study/fonts", () => ({ fontsFor: () => ({ className: "font-test", vars: { "--cs-font-heading": "serif", "--cs-font-body": "sans-serif" } }) }));

import { DEFAULT_THEME, LAYOUTS, type Layout } from "@/lib/case-study/theme";
import type { CaseStudyContent } from "@/lib/case-study/schema";
import type { Template } from "@/lib/templates/model";
import { CaseStudyView } from "./case-study-view";

const template = (layout: Layout): Template => ({ id: "t", name: "T", category: "general", tier: "free", sectionTypes: [], theme: DEFAULT_THEME, layout });

const content: CaseStudyContent = {
  headline: "Faster onboarding",
  client: { name: "Dana", company: "Acme", role: "COO" },
  sections: [
    { type: "challenge", title: "The challenge", body: "Onboarding was slow." },
    { type: "trigger", title: "The trigger", body: "A big customer arrived." },
    { type: "solution", title: "The solution", body: "We changed the process." },
    { type: "results", title: "Results", metrics: [{ label: "Time cut", value: "40 percent", claimId: "c1" }, { label: "Secret hidden", value: "99", claimId: "c2", hidden: true }] },
    { type: "quote", title: "In their words", quote: { text: "It changed everything", attribution: "Dana", claimId: "c3" } },
    { type: "audience", title: "Who it is for", body: "Ops teams." },
    { type: "cta", title: "Talk to us", body: "Book a call." },
  ],
  tags: ["onboarding"],
};

const render = (c: CaseStudyContent, layout: Layout = "classic", extra: Partial<Parameters<typeof CaseStudyView>[0]> = {}) =>
  renderToStaticMarkup(<CaseStudyView content={c} template={template(layout)} theme={DEFAULT_THEME} {...extra} />);

describe("CaseStudyView", () => {
  it.each(LAYOUTS)("the %s layout renders every section, the headline and the client", (layout) => {
    const html = render(content, layout);
    for (const text of ["Faster onboarding", "Dana", "Acme", "The challenge", "The trigger", "The solution", "Results", "Who it is for", "Talk to us", "40 percent", "It changed everything", "Onboarding was slow."]) {
      expect(html, `${layout} is missing "${text}"`).toContain(text);
    }
  });

  it("does not render hidden metrics", () => {
    for (const layout of LAYOUTS) expect(render(content, layout)).not.toContain("Secret hidden");
  });

  it("shows plain text, never markup, whatever the content holds", () => {
    const hostile = [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "</article><script>alert(2)</script>",
      "<a href=\"javascript:alert(3)\">x</a>",
      "<svg onload=alert(4)>",
      "\"><iframe src=//evil.example>",
    ];
    for (const payload of hostile) {
      const evil = {
        headline: payload,
        client: { name: payload, company: payload, role: payload },
        sections: [
          { type: "challenge", title: payload, body: payload },
          { type: "results", title: payload, metrics: [{ label: payload, value: payload, claimId: "c" }] },
          { type: "quote", title: payload, quote: { text: payload, attribution: payload, claimId: "c" } },
          { type: "cta", title: payload, body: payload },
        ],
        tags: [payload],
      } as unknown as CaseStudyContent;
      for (const layout of LAYOUTS) {
        const html = render(evil, layout, { watermark: payload });
        expect(html, `${layout}: ${payload}`).not.toMatch(/<script|<iframe|<svg|<img src=x|<a href/i);
        expect(html).toContain("&lt;");
      }
    }
  });

  it("applies the theme through validated CSS variables and the template's layout name", () => {
    const html = render(content, "timeline");
    expect(html).toContain("--cs-primary:#1d4ed8");
    expect(html).toContain('data-layout="timeline"');
  });

  it("adds a watermark only when asked, as plain text hidden from assistive technology", () => {
    expect(render(content)).not.toContain("Draft - not published");
    const html = render(content, "classic", { watermark: "Draft - not published" });
    expect(html).toContain("Draft - not published");
    expect(html).toContain('aria-hidden="true"');
  });

  it("shows the logo only through the provided signed URL", () => {
    expect(render(content)).not.toContain("<img");
    const html = render(content, "classic", { logoUrl: "https://signed.example/logo.webp?t=1" });
    expect(html).toContain('src="https://signed.example/logo.webp?t=1"');
    expect(html).toContain("Acme logo");
  });

  it("renders a quote section with no quote as plain text rather than failing", () => {
    const html = render({ ...content, sections: [{ type: "quote", title: "Words", body: "Fallback text" }] });
    expect(html).toContain("Fallback text");
  });

  it("before-after pairs the challenge with the results", () => {
    const html = render(content, "before-after");
    expect(html).toContain("Before");
    expect(html).toContain("After");
  });
});

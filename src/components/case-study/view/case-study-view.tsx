import type { CSSProperties } from "react";
import { fontsFor } from "@/lib/case-study/fonts";
import type { CaseStudyContent, Section } from "@/lib/case-study/schema";
import { themeToCssVars, type Theme } from "@/lib/case-study/theme";
import type { Template } from "@/lib/templates/model";
import { Hero, SectionFor } from "./sections";

export interface CaseStudyViewProps {
  content: CaseStudyContent;
  template: Template;
  theme: Theme;
  /** Diagonal text laid over the page, e.g. "Draft - not published". Plain text only. */
  watermark?: string;
  /** Short-lived signed link to the client logo, produced by the server. */
  logoUrl?: string | null;
}

function Watermark({ text }: { text: string }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex select-none flex-wrap content-around justify-around overflow-hidden opacity-[0.12]">
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} className="-rotate-[24deg] whitespace-nowrap p-8 text-3xl font-bold">{text}</span>
      ))}
    </div>
  );
}

const stack = (children: React.ReactNode) => <div className="space-y-[var(--cs-gap)]">{children}</div>;

function Sections({ sections }: { sections: Section[] }) {
  return stack(sections.map((section, i) => <SectionFor key={i} section={section} />));
}

/** Challenge and results side by side as "Before" and "After"; everything else stacked. */
function BeforeAfter({ sections }: { sections: Section[] }) {
  const before = sections.find((s) => s.type === "challenge");
  const after = sections.find((s) => s.type === "results");
  const rest = sections.filter((s) => s !== before && s !== after);
  return stack(
    <>
      {before || after ? (
        <div className="grid gap-[var(--cs-gap)] @md:grid-cols-2">
          {before ? <div className="p-5" style={{ background: "var(--cs-surface)", borderRadius: "var(--cs-radius)" }}><p className="mb-2 text-xs font-bold uppercase tracking-widest" style={{ color: "var(--cs-muted)" }}>Before</p><SectionFor section={before} /></div> : null}
          {after ? <div className="p-5" style={{ border: "2px solid var(--cs-primary)", borderRadius: "var(--cs-radius)" }}><p className="mb-2 text-xs font-bold uppercase tracking-widest" style={{ color: "var(--cs-primary)" }}>After</p><SectionFor section={after} /></div> : null}
        </div>
      ) : null}
      {rest.map((section, i) => <SectionFor key={i} section={section} />)}
    </>,
  );
}

function Timeline({ sections }: { sections: Section[] }) {
  return (
    <ol className="relative space-y-[var(--cs-gap)] pl-8" style={{ borderLeft: "2px solid var(--cs-border)", marginLeft: "0.5rem" }}>
      {sections.map((section, i) => (
        <li key={i} className="relative">
          <span aria-hidden="true" className="absolute -left-[2.6rem] top-0 flex size-6 items-center justify-center rounded-full text-xs font-bold" style={{ background: "var(--cs-primary)", color: "var(--cs-on-primary)" }}>{i + 1}</span>
          <SectionFor section={section} />
        </li>
      ))}
    </ol>
  );
}

/** The results come first, right under the headline: for stories where the numbers are the point. */
function Spotlight({ sections }: { sections: Section[] }) {
  const results = sections.filter((s) => s.type === "results");
  const rest = sections.filter((s) => s.type !== "results");
  return stack(
    <>
      {results.map((section, i) => (
        <div key={`r${i}`} className="p-5 @sm:p-7" style={{ background: "var(--cs-surface)", border: "1px solid var(--cs-border)", borderRadius: "var(--cs-radius)" }}><SectionFor section={section} /></div>
      ))}
      {rest.map((section, i) => <SectionFor key={i} section={section} />)}
    </>,
  );
}

/** The client's own words lead; the story follows. */
function QuoteLed({ sections }: { sections: Section[] }) {
  const quotes = sections.filter((s) => s.type === "quote" && s.quote);
  const rest = sections.filter((s) => !quotes.includes(s));
  return stack(
    <>
      {quotes.map((section, i) => (
        <figure key={`q${i}`} className="p-6 text-center @sm:p-10" style={{ background: "var(--cs-surface)", borderRadius: "var(--cs-radius)" }}>
          <blockquote className="text-2xl italic leading-relaxed @sm:text-3xl" style={{ fontFamily: "var(--cs-font-heading)" }}>&ldquo;{section.quote?.text}&rdquo;</blockquote>
          {section.quote?.attribution ? <figcaption className="mt-4 text-sm" style={{ color: "var(--cs-muted)" }}>{section.quote.attribution}</figcaption> : null}
        </figure>
      ))}
      {rest.map((section, i) => <SectionFor key={i} section={section} />)}
    </>,
  );
}

/** Every section in its own card. The call to action keeps its coloured block. */
function Cards({ sections }: { sections: Section[] }) {
  return stack(
    sections.map((section, i) =>
      section.type === "cta" ? <SectionFor key={i} section={section} /> : (
        <div key={i} className="p-5 @sm:p-6" style={{ background: "var(--cs-surface)", border: "1px solid var(--cs-border)", borderRadius: "var(--cs-radius)" }}><SectionFor section={section} /></div>
      ),
    ),
  );
}

function Frame({ layout, children }: { layout: Template["layout"]; children: React.ReactNode }) {
  const width = layout === "minimal" ? "max-w-xl" : layout === "timeline" || layout === "editorial" ? "max-w-2xl" : "max-w-3xl";
  return <div className={`mx-auto w-full ${width} px-5 py-10 @sm:px-8 @sm:py-14`}>{children}</div>;
}

/**
 * The one renderer. The editor preview, template thumbnails, client preview links and
 * (Phase 6) public pages all use it, so what the owner sees is what the public sees.
 */
export function CaseStudyView({ content, template, theme, watermark, logoUrl }: CaseStudyViewProps) {
  const fonts = fontsFor(theme.fontPair);
  const style = { ...themeToCssVars(theme), ...fonts.vars, background: "var(--cs-bg)", color: "var(--cs-fg)", fontFamily: "var(--cs-font-body)" } as CSSProperties;
  const band = template.layout === "saas-switch";

  const body =
    template.layout === "before-after" ? <BeforeAfter sections={content.sections} />
    : template.layout === "timeline" ? <Timeline sections={content.sections} />
    : template.layout === "spotlight" ? <Spotlight sections={content.sections} />
    : template.layout === "quote-led" ? <QuoteLed sections={content.sections} />
    : template.layout === "cards" ? <Cards sections={content.sections} />
    : <Sections sections={content.sections} />;

  return (
    <article className={`@container relative ${fonts.className} ${template.layout === "editorial" ? "text-lg leading-loose [&_h1]:text-4xl [&_h1]:@sm:text-5xl" : ""}`} style={style} data-layout={template.layout}>
      {watermark ? <Watermark text={watermark} /> : null}
      <Frame layout={template.layout}>
        <div className="space-y-[var(--cs-gap)]">
          {band ? (
            <div className="p-6 @sm:p-8" style={{ background: "var(--cs-primary)", color: "var(--cs-on-primary)", borderRadius: "var(--cs-radius)" }}>
              <Hero headline={content.headline} client={content.client} tags={content.tags} logoUrl={logoUrl} onBand />
            </div>
          ) : (
            <Hero headline={content.headline} client={content.client} tags={content.tags} logoUrl={logoUrl} />
          )}
          {body}
        </div>
      </Frame>
    </article>
  );
}

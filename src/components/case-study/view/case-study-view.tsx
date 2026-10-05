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
        <div className="grid gap-[var(--cs-gap)] md:grid-cols-2">
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

function Frame({ layout, children }: { layout: Template["layout"]; children: React.ReactNode }) {
  const width = layout === "minimal" ? "max-w-xl" : layout === "timeline" ? "max-w-2xl" : "max-w-3xl";
  return <div className={`mx-auto w-full ${width} px-5 py-10 sm:px-8 sm:py-14`}>{children}</div>;
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
    : <Sections sections={content.sections} />;

  return (
    <article className={`relative ${fonts.className}`} style={style} data-layout={template.layout}>
      {watermark ? <Watermark text={watermark} /> : null}
      <Frame layout={template.layout}>
        <div className="space-y-[var(--cs-gap)]">
          {band ? (
            <div className="p-6 sm:p-8" style={{ background: "var(--cs-primary)", color: "var(--cs-on-primary)", borderRadius: "var(--cs-radius)" }}>
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

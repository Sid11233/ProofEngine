import type { CaseStudyContent, Section } from "@/lib/case-study/schema";

// Every component renders text through React text nodes only. There is no HTML string
// anywhere in this folder (ESLint bans dangerouslySetInnerHTML), so even content that
// somehow contained markup would be shown as inert text.

const headingFont = { fontFamily: "var(--cs-font-heading)" } as const;

export function Hero({ headline, client, tags, logoUrl, onBand = false }: { headline: string; client: CaseStudyContent["client"]; tags: string[]; logoUrl?: string | null; onBand?: boolean }) {
  const who = [client.name, client.role, client.company].filter(Boolean).join(" · ");
  return (
    <header className="space-y-4">
      {logoUrl ? <LogoStrip logoUrl={logoUrl} name={client.company ?? client.name} /> : null}
      <h1 className="text-3xl font-bold leading-tight sm:text-4xl" style={headingFont}>{headline}</h1>
      {who ? <p className="text-base" style={{ color: onBand ? "inherit" : "var(--cs-muted)", opacity: onBand ? 0.85 : 1 }}>{who}</p> : null}
      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Topics">
          {tags.map((tag, i) => (
            <li key={i} className="px-2.5 py-0.5 text-sm" style={{ border: "1px solid var(--cs-border)", borderRadius: "999px" }}>{tag}</li>
          ))}
        </ul>
      ) : null}
    </header>
  );
}

export function LogoStrip({ logoUrl, name }: { logoUrl: string; name?: string }) {
  return (
    <div className="flex items-center">
      {/* The URL is a short-lived signed link produced by the server, never user input. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoUrl} alt={name ? `${name} logo` : "Client logo"} className="max-h-12 w-auto max-w-[12rem] object-contain" />
    </div>
  );
}

function TextSection({ section }: { section: Section }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold" style={headingFont}>{section.title}</h2>
      {section.body ? <p className="whitespace-pre-line text-base leading-relaxed" style={{ color: "var(--cs-fg)" }}>{section.body}</p> : null}
    </section>
  );
}

export const Challenge = TextSection;
export const Trigger = TextSection;
export const Solution = TextSection;
export const Audience = TextSection;

export function Results({ section }: { section: Section }) {
  const metrics = (section.metrics ?? []).filter((m) => !m.hidden);
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold" style={headingFont}>{section.title}</h2>
      {section.body ? <p className="whitespace-pre-line text-base leading-relaxed">{section.body}</p> : null}
      {metrics.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {metrics.map((metric, i) => (
            <li key={i} className="p-4" style={{ background: "var(--cs-surface)", border: "1px solid var(--cs-border)", borderRadius: "var(--cs-radius)" }}>
              <p className="text-3xl font-bold" style={{ ...headingFont, color: "var(--cs-primary)" }}>{metric.value}</p>
              <p className="mt-1 text-sm" style={{ color: "var(--cs-muted)" }}>{metric.label}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function Quote({ section }: { section: Section }) {
  if (!section.quote) return <TextSection section={section} />;
  return (
    <section className="space-y-2">
      <h2 className="sr-only">{section.title}</h2>
      <figure className="py-2 pl-5" style={{ borderLeft: "4px solid var(--cs-primary)" }}>
        <blockquote className="text-xl italic leading-relaxed" style={headingFont}>&ldquo;{section.quote.text}&rdquo;</blockquote>
        {section.quote.attribution ? <figcaption className="mt-2 text-sm" style={{ color: "var(--cs-muted)" }}>{section.quote.attribution}</figcaption> : null}
      </figure>
    </section>
  );
}

/** A call to action block. The link or booking target arrives with lead attribution (Phase 7). */
export function Cta({ section }: { section: Section }) {
  return (
    <section className="space-y-2 p-6 text-center" style={{ background: "var(--cs-primary)", color: "var(--cs-on-primary)", borderRadius: "var(--cs-radius)" }}>
      <h2 className="text-xl font-semibold" style={headingFont}>{section.title}</h2>
      {section.body ? <p className="whitespace-pre-line text-base">{section.body}</p> : null}
    </section>
  );
}

export function SectionFor({ section }: { section: Section }) {
  switch (section.type) {
    case "challenge": return <Challenge section={section} />;
    case "trigger": return <Trigger section={section} />;
    case "solution": return <Solution section={section} />;
    case "results": return <Results section={section} />;
    case "quote": return <Quote section={section} />;
    case "audience": return <Audience section={section} />;
    case "cta": return <Cta section={section} />;
  }
}

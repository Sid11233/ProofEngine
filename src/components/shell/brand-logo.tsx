/**
 * The Attract Studio logo for the sidebar: the magnet, then the word "attract" drawn from the same letter shapes as the
 * loader (<LoaderDefs /> in the root layout). Below 120 px of logo width the "studio" tag is left out, and in the
 * collapsed sidebar only the magnet shows.
 */
export function BrandLogo({ iconOnly = false }: { iconOnly?: boolean }) {
  const letter = (x: number, glyph: string, offset: number) => (
    <g key={x} transform={`translate(${x},94)`}>
      <use href={`#as-${glyph}`} transform={`translate(0,22) scale(0.084,-0.084) translate(${offset},0)`} />
    </g>
  );
  return (
    <span className="inline-flex items-center gap-2.5" data-brand-logo>
      <svg viewBox="-45 -45 90 90" width="32" height="32" aria-hidden="true" className="shrink-0">
        <use href="#il-mag" x="-45" y="-45" width="90" height="90" />
      </svg>
      {iconOnly ? (
        <span className="sr-only">Attract Studio</span>
      ) : (
        <svg viewBox="46 56 334 66" height="20" role="img" aria-label="Attract Studio" className="shrink-0 fill-current" style={{ width: "auto" }}>
          {letter(70, "f-a", -278.5)}
          {letter(120, "f-t", -214.5)}
          {letter(164, "f-t", -214.5)}
          {letter(208, "f-r", -216)}
          {letter(256, "f-a", -278.5)}
          {letter(306, "f-c", -251.5)}
          {letter(354, "f-t", -214.5)}
        </svg>
      )}
    </span>
  );
}

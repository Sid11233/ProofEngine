/**
 * The Attract logo: the magnet, then the word "attract" (letter shapes from LoaderDefs). The small "studio" tag is left
 * out, because it is unreadable at this size (below about 120 px of logo width).
 */
export function AttractLogo({ showWord = true, height = 26 }: { showWord?: boolean; height?: number }) {
  const letters: Array<[number, string, number]> = [[70, "f-a", -278.5], [120, "f-t", -214.5], [164, "f-t", -214.5], [208, "f-r", -216], [256, "f-a", -278.5], [306, "f-c", -251.5], [354, "f-t", -214.5]];
  return (
    <span className="inline-flex items-center gap-2" style={{ height }}>
      <svg viewBox="-45 -45 90 90" height={height} width={height} aria-hidden="true" focusable="false">
        <use href="#il-mag" x="-45" y="-45" width="90" height="90" style={{ color: "#0a0a0a" }} />
      </svg>
      {showWord ? (
        <svg viewBox="45 52 330 72" height={Math.round(height * 0.8)} width={Math.round(height * 0.8 * (330 / 72))} aria-hidden="true" focusable="false" fill="currentColor">
          {letters.map(([x, glyph, offset], i) => (
            <g key={i} transform={`translate(${x},94)`}>
              <use href={`#as-${glyph}`} transform={`translate(0,22) scale(0.08400,-0.08400) translate(${offset},0)`} />
            </g>
          ))}
        </svg>
      ) : null}
      <span className="sr-only">Attract</span>
    </span>
  );
}

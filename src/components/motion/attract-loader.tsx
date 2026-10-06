"use client";

import { useEffect, useState } from "react";

const SIZES = { sm: 140, md: 240, lg: 360 } as const;
/** One pass of the animation lasts about 1.8 s; replay it after a short rest while something is still loading. */
const CYCLE_MS = 2600;

/**
 * S-02 Attract Studio loader: the logo lockup. The letters stand, the magnet slides in, the letters tumble towards it
 * and it sweeps left swallowing them; it replays while loading and pauses when the tab is hidden. Reduced motion: the
 * finished lockup, standing still (CSS). The glyph shapes come from <LoaderDefs /> in the root layout.
 */
export function AttractLoader({ size = "md", label = "Loading", className = "" }: { size?: keyof typeof SIZES; label?: string; className?: string }) {
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) setCycle((n) => n + 1); }, CYCLE_MS);
    return () => clearInterval(timer);
  }, []);

  const letter = (x: number, cls: string, glyph: string, offset: number) => (
    <g transform={`translate(${x},94)`}>
      <g className={`as-LT as-ink ${cls}`}>
        <g className={`as-LV ${cls}`}>
          <use href={`#as-${glyph}`} transform={`translate(0,22) scale(0.08400,-0.08400) translate(${offset},0)`} />
        </g>
      </g>
    </g>
  );

  const studio: Array<[string, number]> = [["c-s", 0], ["c-t", 11.9], ["c-u", 23.15], ["c-d", 35.73], ["c-i", 49.4], ["c-o", 56.07]];

  return (
    <div data-anim="S-02" role="status" aria-live="polite" className={`inline-block ${className}`.trim()} style={{ width: SIZES[size], maxWidth: "100%" }}>
      <span className="sr-only">{label}</span>
      <svg key={cycle} className="as-loader" viewBox="-93 20 600 150" aria-hidden="true" style={{ width: "100%", height: "auto" }}>
        <g className="as-cam">
          <g transform="translate(332,141)">
            <g className="as-LV as-org as-st">
              <g transform="translate(-34.2,9) rotate(-4)">
                {studio.map(([glyph, x]) => <use key={glyph} href={`#as-${glyph}`} transform={`translate(${x.toFixed(2)},0) scale(0.03400,-0.03400)`} />)}
              </g>
            </g>
          </g>
        </g>
        {letter(70, "as-l0", "f-a", -278.5)}
        {letter(120, "as-l1", "f-t", -214.5)}
        {letter(164, "as-l2", "f-t", -214.5)}
        {letter(208, "as-l3", "f-r", -216)}
        {letter(256, "as-l4", "f-a", -278.5)}
        {letter(306, "as-l5", "f-c", -251.5)}
        {letter(354, "as-l6", "f-t", -214.5)}
        <g transform="translate(520,94)">
          <g className="as-Min">
            <g className="as-Msw">
              <g className="as-lines">
                <g transform="translate(-72,-8)"><path className="as-line as-n0" d="M-22 0 H0" /></g>
                <g transform="translate(-66,6)"><path className="as-line as-n1" d="M-22 0 H0" /></g>
                <g transform="translate(-76,20)"><path className="as-line as-n2" d="M-18 0 H0" /></g>
              </g>
              <g className="as-MP">
                <g transform="rotate(-90)">
                  <path className="as-mag" d="M-30 -45 V0 a30 30 0 0 0 60 0 V-45" />
                  <rect className="as-tip" x="-45" y="-45" width="30" height="18" />
                  <rect className="as-tip" x="15" y="-45" width="30" height="18" />
                </g>
              </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}

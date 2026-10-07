/**
 * S-02 / M-09, the small version of the loader: dots are pulled into the magnet. Pure CSS (no JavaScript), so it can
 * sit inside any button, including on /i and /sign. Reduced motion: a still magnet with its dots. Colours: the magnet's
 * tips follow the surrounding text colour, the rest is the brand orange.
 */
export function MagnetSpinner({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg data-anim="S-02" className={`as-mini ${className}`.trim()} viewBox="-90 -60 135 120" width={Math.round((size * 135) / 120)} height={size} aria-hidden="true">
      <g className="as-body">
        <g transform="rotate(-90)">
          <path className="as-mag" d="M-30 -45 V0 a30 30 0 0 0 60 0 V-45" />
          <rect className="as-tip" x="-45" y="-45" width="30" height="18" />
          <rect className="as-tip" x="15" y="-45" width="30" height="18" />
        </g>
      </g>
      <circle className="as-dot" cx="-30" cy="-14" r="7" />
      <circle className="as-dot" cx="-30" cy="0" r="7" />
      <circle className="as-dot" cx="-30" cy="14" r="7" />
    </svg>
  );
}

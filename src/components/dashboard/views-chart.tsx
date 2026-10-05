// A bar per day for the last 30 days. Server-rendered SVG, no script. The same numbers are in a
// visually hidden table so screen reader users get the data and not only a picture.

export function ViewsChart({ days }: { days: Array<{ day: string; n: number }> }) {
  const max = Math.max(1, ...days.map((d) => d.n));
  const width = 600;
  const height = 120;
  const slot = width / days.length;
  const total = days.reduce((n, d) => n + d.n, 0);

  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${width} ${height + 18}`} role="img" aria-label={`Page views per day for the last 30 days: ${total} in total`} className="h-auto w-full text-neutral-900 dark:text-neutral-100">
        <line x1="0" y1={height} x2={width} y2={height} stroke="currentColor" strokeOpacity="0.25" />
        {days.map((d, i) => {
          const h = d.n === 0 ? 0 : Math.max(2, (d.n / max) * (height - 4));
          return <rect key={d.day} x={i * slot + 1} y={height - h} width={Math.max(1, slot - 2)} height={h} rx="1.5" fill="currentColor" fillOpacity="0.8" />;
        })}
        <text x="0" y={height + 14} fontSize="10" fill="currentColor" fillOpacity="0.7">{days[0]?.day}</text>
        <text x={width} y={height + 14} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity="0.7">{days[days.length - 1]?.day}</text>
      </svg>
      <table className="sr-only">
        <caption>Page views per day</caption>
        <thead><tr><th>Day</th><th>Views</th></tr></thead>
        <tbody>{days.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.n}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

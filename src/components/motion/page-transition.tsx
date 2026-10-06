/**
 * G-01 Route transition for /app, in CSS (the .anim-route class): on each navigation the new page cross-fades in with
 * an 8 px rise on desktop and a 24 px push on phones (200 ms and 280 ms). Next re-mounts template.tsx per navigation,
 * so this is an enter animation. Reduced motion: a 120 ms fade. Transform and opacity only.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <div data-anim="G-01" className="anim-route">
      {children}
    </div>
  );
}

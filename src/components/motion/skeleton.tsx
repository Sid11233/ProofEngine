/** G-27 Skeleton shimmer. Give it the same size as the content it stands in for, so nothing jumps (S-03). */
export function Skeleton({ className = "", label }: { className?: string; label?: string }) {
  return <div data-anim="G-27" aria-hidden={label ? undefined : true} aria-label={label} className={`anim-skeleton rounded-md ${className}`.trim()} />;
}

/** The busy wrapper for a loading.tsx: announces what is loading once, and keeps the shape of the page. */
export function SkeletonPage({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

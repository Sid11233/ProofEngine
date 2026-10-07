/** G-27 Skeleton shimmer. Give it the same size as the content it stands in for, so nothing jumps (S-03). */
export function Skeleton({ className = "", label }: { className?: string; label?: string }) {
  return <div data-anim="G-27" aria-hidden={label ? undefined : true} aria-label={label} className={`anim-skeleton rounded-md ${className}`.trim()} />;
}

import { AttractLoader } from "./attract-loader";

/** The busy wrapper for a loading.tsx: announces what is loading once, and keeps the shape of the page. */
export function SkeletonPage({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div aria-busy="true" className="relative space-y-6">
      {/* The loader sits above the page-shaped placeholders, which stay visible so nothing jumps when data arrives. */}
      <div className="pointer-events-none absolute inset-x-0 top-6 z-10 flex justify-center">
        <AttractLoader size="md" label={label} />
      </div>
      <div className="space-y-6 opacity-60">{children}</div>
    </div>
  );
}

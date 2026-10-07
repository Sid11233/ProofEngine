import type { HTMLAttributes, ReactNode } from "react";

/** A white surface with a 1 px border and a 14 px radius. `tint` uses the soft orange background. */
export function Card({ tint = false, className = "", children, ...props }: HTMLAttributes<HTMLElement> & { tint?: boolean; children: ReactNode; as?: never }) {
  return (
    <section {...props} className={`rounded-card border ${tint ? "border-[#fbd9c8] bg-tint" : "border-line bg-surface"} p-5 ${className}`.trim()}>
      {children}
    </section>
  );
}

/** The small muted label above a block of content (12 px, medium). */
export function SectionLabel({ children, id, className = "" }: { children: ReactNode; id?: string; className?: string }) {
  return <h2 id={id} className={`text-xs font-medium tracking-wide text-muted ${className}`.trim()}>{children}</h2>;
}

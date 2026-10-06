/** G-48 Skeleton to content crossfade: wrap a page's real content so it fades in (200 ms, opacity only) when it replaces a skeleton. */
export function ContentFade({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div data-anim="G-48" className={`anim-content-in ${className}`.trim()}>
      {children}
    </div>
  );
}

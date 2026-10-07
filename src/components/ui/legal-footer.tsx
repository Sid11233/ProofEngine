import Link from "next/link";

const LINKS = [
  ["/privacy", "Privacy policy"],
  ["/terms", "Terms"],
  ["/subprocessors", "Subprocessors"],
  ["/dpa", "DPA"],
] as const;

/** Quiet footer links, aligned to the page container: muted, small, underlined only on hover. */
export function LegalFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-6xl flex-wrap gap-x-5 gap-y-1 px-4 pb-8 pt-10 text-xs text-muted sm:px-8">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className="inline-flex min-h-9 items-center hover:text-foreground">{label}</Link>
      ))}
    </footer>
  );
}

import Link from "next/link";
import { brand } from "@/lib/brand";

// Draft legal pages. They are written to match what the product actually does, but they have NOT been
// reviewed by a lawyer: the banner stays and search engines are told to skip them until that is done.
export const metadata = { robots: { index: false, follow: false } };

const LINKS = [
  ["/privacy", "Privacy policy"],
  ["/terms", "Terms of service"],
  ["/subprocessors", "Subprocessors"],
  ["/dpa", "Data processing agreement"],
] as const;

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <p role="note" className="border-b border-amber-700/30 bg-amber-50 px-4 py-2 text-center text-sm text-amber-950">
        <strong>Draft.</strong> This document has not yet been reviewed by a lawyer and may change before launch.
      </p>
      <header className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 pt-6">
        <Link href="/" className="font-semibold">{brand.name}</Link>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-4 text-sm">
          {LINKS.map(([href, label]) => <Link key={href} href={href} className="inline-flex min-h-11 items-center underline underline-offset-2">{label}</Link>)}
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-4">{children}</main>
    </div>
  );
}

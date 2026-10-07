import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

const BASE = "inline-flex min-h-9 items-center justify-center rounded-full border px-4 text-sm font-medium transition-colors";
const look = (selected: boolean) => (selected ? "border-foreground bg-foreground text-white" : "border-line bg-surface text-foreground hover:bg-neutral-50");

/** A filter chip. `selected` is exposed as aria-pressed. */
export function Chip({ selected = false, className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; children: ReactNode }) {
  return (
    <button type="button" {...props} aria-pressed={selected} className={`${BASE} ${look(selected)} ${className}`.trim()}>
      {children}
    </button>
  );
}

export function ChipLink({ href, selected = false, children }: { href: string; selected?: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={selected ? "true" : undefined} className={`${BASE} no-underline hover:no-underline ${look(selected)}`}>
      {children}
    </Link>
  );
}

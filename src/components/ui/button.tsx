import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { MagnetSpinner } from "@/components/motion/magnet-spinner";

export type ButtonVariant = "primary" | "secondary" | "quiet";
type Size = "md" | "sm";

const BASE = "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-foreground text-white hover:bg-neutral-800 disabled:hover:bg-foreground",
  secondary: "border border-line bg-surface text-foreground hover:bg-neutral-50",
  quiet: "text-foreground hover:bg-black/[0.05]",
};
const SIZE: Record<Size, string> = { md: "min-h-11 px-4 text-sm", sm: "min-h-9 px-3 text-sm" };

export const buttonClass = (variant: ButtonVariant = "primary", size: Size = "md", extra = "") => `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${extra}`.trim();

/** Primary (black), secondary (outline) or quiet. `loading` shows the magnet and disables the button. */
export function Button({ variant = "primary", size = "md", loading = false, className = "", children, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: Size; loading?: boolean; children: ReactNode }) {
  return (
    <button {...props} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)}>
      {loading ? <MagnetSpinner size={16} /> : null}
      {children}
    </button>
  );
}

/** A link that looks like a button (for navigation). */
export function ButtonLink({ variant = "primary", size = "md", className = "", href, children, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string; variant?: ButtonVariant; size?: Size; children: ReactNode }) {
  return (
    <Link {...props} href={href} className={`${buttonClass(variant, size, className)} no-underline hover:no-underline`}>
      {children}
    </Link>
  );
}

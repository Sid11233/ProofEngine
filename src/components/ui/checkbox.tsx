import type { InputHTMLAttributes, ReactNode } from "react";

/**
 * A custom-looking checkbox that is still a real <input type="checkbox">: keyboard, labels and form posts work as
 * usual. The check is drawn when ticked. Pass the label as children.
 */
export function Checkbox({ children, className = "", ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { children: ReactNode }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-start gap-3 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 ${className}`.trim()}>
      <span className="relative mt-0.5 inline-flex size-5 shrink-0">
        <input type="checkbox" {...props} className="peer absolute inset-0 size-5 cursor-pointer appearance-none rounded-md border border-[#a8a29e] bg-surface transition-colors checked:border-foreground checked:bg-foreground disabled:cursor-not-allowed" />
        <svg viewBox="0 0 20 20" aria-hidden="true" className="pointer-events-none absolute inset-0 size-5 text-white opacity-0 peer-checked:opacity-100">
          <path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="min-w-0">{children}</span>
    </label>
  );
}

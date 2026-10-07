import type { SelectHTMLAttributes } from "react";
import { Icon } from "./icons";

/**
 * A styled select: our border, radius, focus ring and chevron, on the real <select> element, so keyboard, screen
 * readers and the phone's own picker keep working.
 */
export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={`relative block ${className}`.trim()}>
      <select {...props} className="block min-h-11 w-full appearance-none rounded-control border border-line bg-surface py-2 pl-3 pr-9 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50">
        {children}
      </select>
      <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
    </span>
  );
}

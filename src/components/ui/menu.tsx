"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * A button that opens a small panel of links and buttons. Closes on Escape, on a click outside and when focus leaves,
 * and returns focus to the button. `trigger` is what the button shows; `label` is its accessible name.
 */
export function Menu({ label, trigger, children, align = "left", panelClassName = "", buttonClassName = "" }: { label: string; trigger: ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: "left" | "right"; panelClassName?: string; buttonClassName?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={root} className="relative" onBlur={(event) => { if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <button ref={button} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className={buttonClassName}>
        {trigger}
      </button>
      {open && (
        <div id={id} role="dialog" aria-label={label} className={`anim-menu absolute z-50 mt-2 min-w-56 rounded-card border border-line bg-surface p-1.5 text-sm shadow-lg ${align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left"} ${panelClassName}`.trim()}>
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export const menuItemClass = "flex min-h-10 w-full items-center gap-2 rounded-control px-3 text-left text-sm text-foreground no-underline hover:bg-black/[0.05] hover:no-underline";

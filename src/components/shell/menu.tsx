"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * A button that opens a small panel (G-13: scales from the button, 140 ms, opacity only when motion is reduced).
 * The panel stays in the page while closed (hidden), so things inside it that must keep listening, such as the
 * install prompt, keep working. Escape or a click outside closes it and focus goes back to the button.
 */
export function MenuButton({ label, button, children, align = "right", panelClassName = "" }: { label: string; button: ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: "left" | "right"; panelClassName?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <div ref={root} className="relative" onBlur={(event) => { if (open && !root.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <button ref={trigger} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="inline-flex size-11 items-center justify-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--signal-strong)]">
        {button}
      </button>
      <div id={id} role="menu" hidden={!open} data-anim="G-13" className={`anim-pop absolute top-full z-50 mt-2 w-72 rounded-card border border-line bg-surface p-2 shadow-lg ${align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left"} ${panelClassName}`.trim()}>
        {typeof children === "function" ? children(close) : children}
      </div>
    </div>
  );
}

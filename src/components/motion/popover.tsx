"use client";

import { AnimatePresence, m } from "motion/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { DURATION_MS, EASE, seconds } from "@/lib/motion/tokens";
import { useReducedMotion } from "@/lib/motion/useReducedMotion";

/**
 * G-13 Popover and dropdown: scales 0.95 to 1 from the side of the button it opens from, 140 ms. Closes on Escape,
 * on a click outside, and when focus leaves; focus returns to the button. Reduced motion: fade only.
 */
export function Popover({ label, children, align = "left" }: { label: string; children: ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={root} className="relative inline-block" onBlur={(event) => { if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <button ref={button} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-3 text-sm">
        {label}
      </button>
      <AnimatePresence>
        {open && (
          <m.div
            id={id}
            data-anim="G-13"
            role="dialog"
            aria-label={label}
            className={`absolute z-40 mt-1 min-w-48 rounded-md border border-neutral-200 bg-surface p-2 text-sm shadow-lg ${align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left"}`}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
            transition={{ duration: seconds(DURATION_MS.micro), ease: EASE.standard }}
          >
            {children}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

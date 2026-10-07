"use client";

import { AnimatePresence, m } from "motion/react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DURATION_MS, EASE, seconds } from "@/lib/motion/tokens";
import { useReducedMotion } from "@/lib/motion/useReducedMotion";

const FOCUSABLE = 'a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * G-10 Dialog: scale 0.96 to 1 and fade over 260 ms, exit 160 ms, the backdrop fades. Reduced motion: fade only.
 * Focus moves into the dialog, Tab stays inside it, Escape and a click on the backdrop close it, and focus returns to
 * what opened it. The page behind does not scroll.
 */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const [first, last] = [items[0], items[items.length - 1]];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div data-anim="G-10" className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={onKeyDown}>
          <m.div
            className="absolute inset-0 bg-black/40"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: seconds(DURATION_MS.standard) }}
          />
          <m.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="relative w-full max-w-md space-y-4 rounded-lg border border-neutral-200 bg-surface p-5 shadow-xl outline-none"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={{ duration: seconds(DURATION_MS.standard), ease: EASE.standard }}
          >
            <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
            {children}
          </m.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

"use client";

import { AnimatePresence, m } from "motion/react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { spring } from "@/lib/motion/springs";
import { useReducedMotion } from "@/lib/motion/useReducedMotion";

export type ToastTone = "info" | "success" | "error";
interface ToastItem { id: number; message: string; tone: ToastTone }

const AUTO_DISMISS_MS = 4000;
const MAX_TOASTS = 3;
const ToastContext = createContext<{ show: (message: string, tone?: ToastTone) => void }>({ show: () => undefined });

/** Show a short message: `const { show } = useToast(); show("Saved", "success")`. Plain text only. */
export const useToast = () => useContext(ToastContext);

/**
 * G-12 Toast: slides and scales in from the edge on the default spring, dismisses itself after 4 s with a shrinking
 * bar (paused while hovered or focused), and can be swiped away or closed with the button. Announced politely to
 * screen readers. Reduced motion: fade only.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const reduced = useReducedMotion();

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback((message: string, tone: ToastTone = "info") => {
    const id = next.current++;
    setItems((list) => [...list.slice(-(MAX_TOASTS - 1)), { id, message: message.slice(0, 200), tone }]);
  }, []);
  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div data-anim="G-12" role="region" aria-label="Notifications" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <ToastCard key={item.id} item={item} reduced={reduced} onDismiss={dismiss} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, reduced, onDismiss }: { item: ToastItem; reduced: boolean; onDismiss: (id: number) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [paused, setPaused] = useState(false);
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (timer.current) clearTimeout(timer.current);
      if (node) timer.current = setTimeout(() => onDismiss(item.id), AUTO_DISMISS_MS);
    },
    [item.id, onDismiss],
  );
  const pause = (on: boolean) => {
    setPaused(on);
    if (on && timer.current) clearTimeout(timer.current);
    if (!on) timer.current = setTimeout(() => onDismiss(item.id), AUTO_DISMISS_MS);
  };
  const colour = item.tone === "error" ? "border-red-700/40" : item.tone === "success" ? "border-green-700/40" : "border-neutral-300";

  return (
    <m.div
      ref={ref}
      layout={!reduced}
      role={item.tone === "error" ? "alert" : "status"}
      className={`pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-md border ${colour} bg-[#faf7f0] shadow-lg`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: 40 }}
      transition={reduced ? { duration: 0.14 } : spring("default")}
      drag={reduced ? false : "x"}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 80 || Math.abs(info.velocity.x) > 500) onDismiss(item.id); }}
      onMouseEnter={() => pause(true)}
      onMouseLeave={() => pause(false)}
      onFocus={() => pause(true)}
      onBlur={() => pause(false)}
    >
      <div className="flex items-start gap-3 px-3 py-2.5 text-sm">
        <p className="min-w-0 flex-1">{item.message}</p>
        <button type="button" onClick={() => onDismiss(item.id)} aria-label="Dismiss" className="inline-flex size-8 shrink-0 items-center justify-center rounded text-neutral-600 hover:bg-black/5">×</button>
      </div>
      <div aria-hidden="true" className="h-0.5 bg-[var(--signal)]/70">
        <div key={String(paused)} className={`h-full origin-left bg-[var(--signal)] ${paused ? "" : "anim-shrink"}`} style={{ ["--anim-shrink-ms" as string]: `${AUTO_DISMISS_MS}ms`, transform: paused ? "scaleX(0.5)" : undefined }} />
      </div>
    </m.div>
  );
}

"use client";

import { AnimatePresence, m } from "motion/react";
import { useId, useRef, useState, type ReactNode } from "react";
import { spring } from "@/lib/motion/springs";
import { DURATION_MS, EASE, seconds } from "@/lib/motion/tokens";
import { useReducedMotion } from "@/lib/motion/useReducedMotion";

export interface TabDef {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * G-02 Sliding tab indicator (a shared layout spring) and G-03 Tab content transition (direction aware: the old panel
 * leaves 10 px and fades in 120 ms, the new one arrives from the other side in 260 ms). Keyboard: arrow keys, Home and
 * End move between tabs (roving tabindex). Reduced motion: the indicator moves instantly and the panels only fade.
 * Scroll position per tab is not kept yet.
 */
export function AnimatedTabs({ tabs, label }: { tabs: TabDef[]; label: string }) {
  const [active, setActive] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const reduced = useReducedMotion();
  const base = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number, focus = false) => {
    setDirection(index >= active ? 1 : -1);
    setActive(index);
    if (focus) buttons.current[index]?.focus();
  };
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const target = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (target === null) return;
    event.preventDefault();
    select(target, true);
  };

  return (
    <div>
      <div data-anim="G-02" role="tablist" aria-label={label} className="relative flex gap-1 border-b border-neutral-200">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => { buttons.current[index] = node; }}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.id}`}
            aria-selected={index === active}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={index === active ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className="relative inline-flex min-h-11 items-center px-4 text-sm"
          >
            <span className={index === active ? "font-medium" : "text-neutral-600"}>{tab.label}</span>
            {index === active && <m.span layoutId={`${base}-indicator`} transition={spring("default")} className="absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-[var(--signal-strong)]" />}
          </button>
        ))}
      </div>
      <div className="pt-4">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <m.div
            key={tabs[active].id}
            data-anim="G-03"
            role="tabpanel"
            id={`${base}-panel-${tabs[active].id}`}
            aria-labelledby={`${base}-tab-${tabs[active].id}`}
            tabIndex={0}
            custom={direction}
            variants={{
              enter: (d: 1 | -1) => ({ opacity: 0, x: reduced ? 0 : d * 10 }),
              center: { opacity: 1, x: 0, transition: { duration: seconds(DURATION_MS.standard), ease: EASE.standard } },
              leave: (d: 1 | -1) => ({ opacity: 0, x: reduced ? 0 : d * -10, transition: { duration: seconds(120) } }),
            }}
            initial="enter"
            animate="center"
            exit="leave"
          >
            {tabs[active].content}
          </m.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

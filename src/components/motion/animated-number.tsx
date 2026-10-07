"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/motion/useReducedMotion";

const DURATION_MS = 600;

/**
 * G-29 Number count-up: counts from 0 to the value over 600 ms with an ease-out, once, when it first appears. Tabular
 * figures so the width does not jump. The server renders the final value (so it is right without JavaScript and for
 * screen readers); reduced motion leaves it that way.
 */
export function AnimatedNumber({ value, suffix = "", className = "" }: { value: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const played = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced || played.current || value <= 0) return;
    played.current = true;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      node.textContent = `${Math.round(value * (1 - Math.pow(1 - t, 3)))}${suffix}`;
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); node.textContent = `${value}${suffix}`; };
  }, [value, suffix, reduced]);

  return (
    <span ref={ref} data-anim="G-29" className={`tnum ${className}`.trim()}>
      {value}{suffix}
    </span>
  );
}

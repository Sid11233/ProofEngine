"use client";

import { m } from "motion/react";
import type { ReactNode } from "react";
import { fadeOnly, fadeUp, stagger } from "@/lib/motion/variants";
import { useReducedMotion } from "@/lib/motion/useReducedMotion";

/**
 * G-22 List stagger entry: items fade up 12 px with a 40 ms stagger, at most 8 items staggered (later ones appear
 * with the 8th). Reduced motion: fade only, no movement and no stagger.
 */
export function ListStagger({ items, className, itemClassName, as = "ul" }: { items: ReactNode[]; className?: string; itemClassName?: string; as?: "ul" | "ol" }) {
  const reduced = useReducedMotion();
  const List = as === "ol" ? m.ol : m.ul;
  return (
    <List data-anim="G-22" className={className} variants={stagger} initial="hidden" animate="visible">
      {items.map((item, index) => (
        <m.li key={index} className={itemClassName} custom={index} variants={reduced ? fadeOnly : fadeUp}>
          {item}
        </m.li>
      ))}
    </List>
  );
}

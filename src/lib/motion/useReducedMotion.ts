"use client";

export { useMotionPreference as useReducedMotionState } from "@/components/motion/motion-provider";
import { useMotionPreference } from "@/components/motion/motion-provider";

/** True when animations should be reduced: the in-app setting wins over the system's prefers-reduced-motion. */
export const useReducedMotion = (): boolean => useMotionPreference().reduced;

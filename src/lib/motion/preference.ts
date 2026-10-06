// The reduced-motion decision. The in-app setting overrides the system's; with no choice, the system's applies.

export type MotionPreference = "system" | "reduce" | "full";

export const MOTION_COOKIE = "pe_motion";

export function parsePreference(value: string | undefined | null): MotionPreference {
  return value === "reduce" || value === "full" ? value : "system";
}

/** True when animations should be reduced. */
export function resolveReducedMotion(systemPrefersReduced: boolean, preference: MotionPreference): boolean {
  if (preference === "reduce") return true;
  if (preference === "full") return false;
  return systemPrefersReduced;
}

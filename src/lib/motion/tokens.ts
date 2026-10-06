// Motion tokens, exactly as in docs/animation-reference.md ("Motion tokens and global rules").
// The same values are exposed to CSS in globals.css (--motion-*), so CSS-only animations match.

export const DURATION_MS = {
  instant: 90,
  micro: 140,
  standard: 260,
  emphasis: 480,
  /** Onboarding and splash only. */
  onboarding: 800,
} as const;
export type DurationName = keyof typeof DURATION_MS;

/** No animation may be longer than this outside onboarding and splash. */
export const MAX_DURATION_MS = 600;

export const STAGGER_MS = 40;
/** Items past the cap appear together with the last staggered item. */
export const MAX_STAGGER_ITEMS = 8;

/** Cubic-bezier control points (for the motion library). */
export const EASE = {
  standard: [0.22, 1, 0.36, 1],
  emphasized: [0.65, 0, 0.35, 1],
  accelerate: [0.55, 0, 0.85, 0.35],
  decelerate: [0.16, 1, 0.3, 1],
} as const;
export type EaseName = keyof typeof EASE;

/** The same curves as CSS values. */
export const EASE_CSS: Record<EaseName, string> = {
  standard: "cubic-bezier(0.22, 1, 0.36, 1)",
  emphasized: "cubic-bezier(0.65, 0, 0.35, 1)",
  accelerate: "cubic-bezier(0.55, 0, 0.85, 0.35)",
  decelerate: "cubic-bezier(0.16, 1, 0.3, 1)",
};

export const SPRING = {
  gentle: { stiffness: 120, damping: 20 },
  default: { stiffness: 300, damping: 30 },
  snappy: { stiffness: 500, damping: 35 },
  bouncy: { stiffness: 400, damping: 18 },
} as const;
export type SpringName = keyof typeof SPRING;

/** Seconds, for the motion library. */
export const seconds = (ms: number) => ms / 1000;

/** Delay for the nth item of a staggered list: 40 ms each, capped at the 8th item. */
export const staggerDelayMs = (index: number) => Math.min(Math.max(index, 0), MAX_STAGGER_ITEMS - 1) * STAGGER_MS;

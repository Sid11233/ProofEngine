import { DURATION_MS, EASE, seconds, staggerDelayMs } from "./tokens";

// Variants animate transform and opacity only. Each has a reduced counterpart (opacity only, or instant).

const standard = { duration: seconds(DURATION_MS.standard), ease: EASE.standard };

/** Fade up 12 px (G-22 and most list entries). */
export const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: (index: number = 0) => ({ opacity: 1, y: 0, transition: { ...standard, delay: seconds(staggerDelayMs(index)) } }),
};

/** Scale in from 0.96 (dialogs, G-10). */
export const scaleIn = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: standard },
  exit: { opacity: 0, scale: 0.96, transition: { duration: seconds(160), ease: EASE.accelerate } },
};

/** Slide in from the side the user is moving towards (direction 1 = from the right/below, -1 = the other way). */
export const slideDirection = (direction: 1 | -1, distance = 24) => ({
  hidden: { opacity: 0, x: direction * distance },
  visible: { opacity: 1, x: 0, transition: standard },
  exit: { opacity: 0, x: -direction * distance, transition: { duration: seconds(120), ease: EASE.accelerate } },
});

/** Parent variant for lists: children use `fadeUp` with their index as the custom value. */
export const stagger = { hidden: {}, visible: {} };

/** Opacity only, for reduced motion (the "Fade" fallback). */
export const fadeOnly = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: seconds(DURATION_MS.micro) } },
  exit: { opacity: 0, transition: { duration: seconds(DURATION_MS.instant) } },
};

/** No transition at all (the "Instant" fallback). */
export const instant = { hidden: { opacity: 1 }, visible: { opacity: 1, transition: { duration: 0 } }, exit: { opacity: 1, transition: { duration: 0 } } };

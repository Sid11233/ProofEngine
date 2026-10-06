// Every implemented animation registers here, and tags its root element with data-anim="ID".
// A test checks that each registered ID exists in docs/animation-reference.md; the audit prompt compares the two.

export type MotionStatus = "planned" | "built" | "needs-review";

export interface MotionEntry {
  /** An ID from docs/animation-reference.md, such as G-22. */
  id: string;
  name: string;
  /** The component that carries data-anim, or "css" for pure CSS behaviour. */
  component: string;
  /** Where it lives, relative to the repo root. */
  file: string;
  status: MotionStatus;
}

export const MOTION_REGISTRY: readonly MotionEntry[] = [
  { id: "G-15", name: "Button press", component: "PressableButton", file: "src/components/motion/pressable-button.tsx", status: "built" },
  { id: "G-22", name: "List stagger entry", component: "ListStagger", file: "src/components/motion/list-stagger.tsx", status: "built" },
];

export const registeredIds = () => MOTION_REGISTRY.map((entry) => entry.id);

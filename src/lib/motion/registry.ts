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
  { id: "G-01", name: "Route transition", component: "PageTransition", file: "src/components/motion/page-transition.tsx", status: "built" },
  { id: "G-02", name: "Sliding tab indicator", component: "AnimatedTabs", file: "src/components/motion/animated-tabs.tsx", status: "built" },
  { id: "G-03", name: "Tab content transition", component: "AnimatedTabs", file: "src/components/motion/animated-tabs.tsx", status: "built" },
  { id: "G-05", name: "Active nav pill glide", component: "AppNav", file: "src/components/motion/app-nav.tsx", status: "built" },
  { id: "G-06", name: "Bottom tab bar indicator and icon bounce", component: "BottomTabBar", file: "src/components/motion/bottom-tab-bar.tsx", status: "built" },
  { id: "G-10", name: "Dialog enter and exit", component: "Dialog", file: "src/components/motion/dialog.tsx", status: "built" },
  { id: "G-12", name: "Toast", component: "ToastProvider", file: "src/components/motion/toast.tsx", status: "built" },
  { id: "G-13", name: "Popover and dropdown", component: "Popover", file: "src/components/motion/popover.tsx", status: "built" },
  { id: "G-15", name: "Button press", component: "PressableButton", file: "src/components/motion/pressable-button.tsx", status: "built" },
  { id: "G-16", name: "Button loading to success", component: "LoadingButton", file: "src/components/motion/loading-button.tsx", status: "built" },
  { id: "S-02", name: "Magnet loader (Attract Studio lockup)", component: "AttractLoader", file: "src/components/motion/attract-loader.tsx", status: "built" },
  { id: "G-22", name: "List stagger entry", component: "ListStagger", file: "src/components/motion/list-stagger.tsx", status: "built" },
  { id: "G-27", name: "Skeleton shimmer", component: "Skeleton", file: "src/components/motion/skeleton.tsx", status: "built" },
  { id: "G-39", name: "Copy confirm", component: "CopyButton", file: "src/components/motion/copy-button.tsx", status: "built" },
  { id: "G-48", name: "Skeleton to content crossfade", component: "ContentFade", file: "src/components/motion/content-fade.tsx", status: "built" },
];

export const registeredIds = () => MOTION_REGISTRY.map((entry) => entry.id);

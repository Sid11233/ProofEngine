"use client";

import { useState, type ReactNode } from "react";
import { DURATION_MS, EASE_CSS, MAX_STAGGER_ITEMS, SPRING, STAGGER_MS } from "@/lib/motion/tokens";
import type { MotionEntry } from "@/lib/motion/registry";
import { AttractLoader } from "./attract-loader";
import { MagnetSpinner } from "./magnet-spinner";
import { AnimatedTabs } from "./animated-tabs";
import { ContentFade } from "./content-fade";
import { CopyButton } from "./copy-button";
import { Dialog } from "./dialog";
import { ListStagger } from "./list-stagger";
import { LoadingButton, type ButtonPhase } from "./loading-button";
import { Popover } from "./popover";
import { Skeleton } from "./skeleton";
import { ToastProvider, useToast } from "./toast";
import { MotionPreferenceControl } from "./motion-preference-control";
import { MotionProvider } from "./motion-provider";
import { PressableButton } from "./pressable-button";
import type { MotionPreference } from "@/lib/motion/preference";

function DialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-md border border-neutral-400 px-3 text-sm">Open dialog</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="A dialog">
        <p className="text-sm">Tab stays inside. Escape or the backdrop closes it.</p>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-md border border-neutral-400 px-3 text-sm">Close</button>
      </Dialog>
    </>
  );
}
function ToastDemo() {
  const { show } = useToast();
  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => show("Saved your changes", "success")} className="min-h-11 rounded-md border border-neutral-400 px-3 text-sm">Success toast</button>
      <button type="button" onClick={() => show("That did not work", "error")} className="min-h-11 rounded-md border border-neutral-400 px-3 text-sm">Error toast</button>
    </div>
  );
}
function LoadingDemo() {
  const [phase, setPhase] = useState<ButtonPhase>("idle");
  const go = () => { setPhase("loading"); setTimeout(() => { setPhase("success"); setTimeout(() => setPhase("idle"), 1200); }, 1000); };
  return <LoadingButton type="button" phase={phase} onClick={go} className="min-h-11 rounded-md bg-neutral-900 px-5 text-sm font-medium text-white">Save</LoadingButton>;
}

const DEMOS: Record<string, () => ReactNode> = {
  "G-01": () => <p className="text-sm text-neutral-600">Navigate between pages in the app: each page fades in with a short rise (a push on phones).</p>,
  "G-02": () => <AnimatedTabs label="Demo tabs" tabs={[{ id: "a", label: "First", content: <p className="text-sm">First panel</p> }, { id: "b", label: "Second", content: <p className="text-sm">Second panel</p> }, { id: "c", label: "Third", content: <p className="text-sm">Third panel</p> }]} />,
  "G-03": () => <p className="text-sm text-neutral-600">See the tabs above: panels slide by direction.</p>,
  "G-05": () => <p className="text-sm text-neutral-600">The pill under the main navigation glides between pages.</p>,
  "G-06": () => <p className="text-sm text-neutral-600">On a phone-width window, the bottom bar shows an indicator and a tapped icon bounces.</p>,
  "G-10": () => <DialogDemo />,
  "G-12": () => <ToastDemo />,
  "G-13": () => <Popover label="Open popover"><p className="px-2 py-1">Hello from a popover.</p></Popover>,
  "G-16": () => <LoadingDemo />,
  "S-02": () => <div className="flex flex-wrap items-center gap-6"><AttractLoader size="md" label="Demo loader" /><span className="inline-flex items-center gap-2 text-sm"><MagnetSpinner size={24} /> small version</span></div>,
  "G-27": () => <div className="space-y-2"><Skeleton className="h-6 w-48" /><Skeleton className="h-16" /></div>,
  "G-39": () => <CopyButton text="https://example.com/demo-link" label="Copy link" />,
  "G-48": () => <ContentFade className="rounded-md border border-neutral-300 p-3 text-sm">Content that fades in as it replaces a skeleton.</ContentFade>,
  "G-15": () => <PressableButton type="button" className="min-h-11 rounded-md border border-neutral-400 px-4 text-sm">Press and hold me</PressableButton>,
  "G-22": () => <Replay>{(key) => <ListStagger key={key} className="space-y-1" itemClassName="rounded-md border border-neutral-300 px-3 py-2 text-sm" items={Array.from({ length: 10 }, (_, i) => `Item ${i + 1}${i >= MAX_STAGGER_ITEMS ? " (appears with item 8)" : ""}`)} />}</Replay>,
};

function Replay({ children }: { children: (key: number) => ReactNode }) {
  const [key, setKey] = useState(0);
  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setKey(key + 1)} className="min-h-11 rounded-md border border-neutral-400 px-3 text-sm">Replay</button>
      {children(key)}
    </div>
  );
}

/** Every registered animation with a live demo, the tokens, and the reduced-motion switch. */
export function MotionLab({ entries, initialPreference }: { entries: readonly MotionEntry[]; initialPreference: MotionPreference }) {
  return (
    <MotionProvider initialPreference={initialPreference}>
      <ToastProvider>
      <div className="space-y-8">
        <section aria-labelledby="lab-pref" className="space-y-2">
          <h2 id="lab-pref" className="text-lg font-semibold">Reduced motion</h2>
          <MotionPreferenceControl />
        </section>

        <section aria-labelledby="lab-reg" className="space-y-3">
          <h2 id="lab-reg" className="text-lg font-semibold">Registered animations ({entries.length})</h2>
          {entries.map((entry) => (
            <article key={entry.id} className="space-y-2 rounded-md border border-neutral-300 p-4">
              <h3 className="font-medium">{entry.id}: {entry.name} <span className="text-sm font-normal text-neutral-600">({entry.status})</span></h3>
              <p className="text-xs text-neutral-600">{entry.component} in {entry.file}</p>
              {DEMOS[entry.id]?.() ?? <p className="text-sm text-neutral-600">No demo yet.</p>}
            </article>
          ))}
        </section>

        <section aria-labelledby="lab-tokens" className="space-y-2">
          <h2 id="lab-tokens" className="text-lg font-semibold">Tokens</h2>
          <p className="text-sm">Durations: {Object.entries(DURATION_MS).map(([k, v]) => `${k} ${v} ms`).join(", ")}. Stagger {STAGGER_MS} ms, max {MAX_STAGGER_ITEMS} items.</p>
          <p className="text-sm">Springs: {Object.entries(SPRING).map(([k, v]) => `${k} (${v.stiffness}/${v.damping})`).join(", ")}.</p>
          <ul className="text-sm text-neutral-700">{Object.entries(EASE_CSS).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
        </section>
      </div>
      </ToastProvider>
    </MotionProvider>
  );
}

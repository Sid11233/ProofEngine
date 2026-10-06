"use client";

import { useState, type ReactNode } from "react";
import { DURATION_MS, EASE_CSS, MAX_STAGGER_ITEMS, SPRING, STAGGER_MS } from "@/lib/motion/tokens";
import type { MotionEntry } from "@/lib/motion/registry";
import { ListStagger } from "./list-stagger";
import { MotionPreferenceControl } from "./motion-preference-control";
import { MotionProvider } from "./motion-provider";
import { PressableButton } from "./pressable-button";
import type { MotionPreference } from "@/lib/motion/preference";

const DEMOS: Record<string, () => ReactNode> = {
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
    </MotionProvider>
  );
}

"use client";

import { useMotionPreference } from "./motion-provider";
import type { MotionPreference } from "@/lib/motion/preference";

const OPTIONS: Array<{ value: MotionPreference; label: string; hint: string }> = [
  { value: "system", label: "Follow my device", hint: "Reduce motion when your device is set to." },
  { value: "reduce", label: "Reduce motion", hint: "Fades and instant changes only, no movement." },
  { value: "full", label: "Allow motion", hint: "Use full animations even if your device asks to reduce them." },
];

/** The in-app Reduce motion setting. It overrides the device setting. Saved in this browser. */
export function MotionPreferenceControl() {
  const { preference, setPreference, reduced } = useMotionPreference();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Motion</legend>
      {OPTIONS.map((option) => (
        <label key={option.value} className="flex min-h-11 items-start gap-3 text-sm">
          <input type="radio" name="motion" className="mt-1 size-5" checked={preference === option.value} onChange={() => setPreference(option.value)} />
          <span>
            <span className="font-medium">{option.label}</span>
            <span className="block text-neutral-600">{option.hint}</span>
          </span>
        </label>
      ))}
      <p role="status" className="text-sm text-neutral-600">{reduced ? "Motion is reduced right now." : "Animations are on."}</p>
    </fieldset>
  );
}

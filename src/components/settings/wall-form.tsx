"use client";

import { useState } from "react";
import type { FormState } from "@/lib/validation/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";

interface Props {
  initial: { enabled: boolean; originsText: string; layout: "grid" | "list"; maxItems: number };
  /** Full embed URL, or null when the workspace has no public address yet. */
  embedUrl: string | null;
  save: (input: { enabled: boolean; originsText: string; layout: string; maxItems: number }) => Promise<FormState>;
}

const field = "block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base dark:border-neutral-700";

export function WallForm({ initial, embedUrl, save }: Props) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [origins, setOrigins] = useState(initial.originsText);
  const [layout, setLayout] = useState(initial.layout);
  const [maxItems, setMaxItems] = useState(initial.maxItems);
  const [state, setState] = useState<FormState | null>(null);
  const [pending, setPending] = useState(false);

  const snippet = embedUrl ? `<iframe src="${embedUrl}" title="Customer results" width="100%" height="640" style="border:0" loading="lazy"></iframe>` : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setState(await save({ enabled, originsText: origins, layout, maxItems }));
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)}><span className="font-medium">Allow the wall of proof to be embedded</span></Checkbox>

      <div className="space-y-1">
        <label htmlFor="wall-origins" className="block text-sm font-medium">Sites allowed to embed it (one per line)</label>
        <textarea id="wall-origins" value={origins} onChange={(e) => setOrigins(e.target.value)} rows={4} placeholder={"https://www.example.com"} className={`${field} font-mono text-sm`} />
        <p className="text-sm text-neutral-600 dark:text-neutral-400">https only, no paths or wildcards. Any other site that tries to frame the widget is blocked by the browser.</p>
      </div>

      <div className="grid gap-4 @sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="wall-layout" className="block text-sm font-medium">Layout</label>
          <Select id="wall-layout" value={layout} onChange={(e) => setLayout(e.target.value === "list" ? "list" : "grid")} className="w-full">
            <option value="grid">Grid of cards</option>
            <option value="list">List</option>
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="wall-max" className="block text-sm font-medium">Stories to show (1 to 24)</label>
          <input id="wall-max" type="number" min={1} max={24} value={maxItems} onChange={(e) => setMaxItems(Number(e.target.value))} className={field} />
        </div>
      </div>

      <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center rounded-md bg-neutral-900 px-5 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">Save</button>
      <div role="status" aria-live="polite">
        {state ? <p className={state.ok ? "text-sm text-green-800 dark:text-green-300" : "text-sm text-red-700 dark:text-red-400"}>{state.message}</p> : null}
      </div>

      <div className="space-y-1 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <p className="text-sm font-medium">Embed code</p>
        {snippet ? <textarea readOnly aria-label="Embed code" value={snippet} rows={3} onFocus={(e) => e.currentTarget.select()} className={`${field} font-mono text-sm`} /> : <p className="text-sm text-neutral-600 dark:text-neutral-400">Public pages are not set up yet, so there is no embed address.</p>}
      </div>
    </form>
  );
}

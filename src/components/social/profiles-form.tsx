"use client";

import { useState, useTransition } from "react";
import type { FormState } from "@/lib/validation/form";

export interface ProfileField {
  network: string;
  label: string;
  value: string;
}

export function ProfilesForm({ fields, save }: { fields: ProfileField[]; save: (input: unknown) => Promise<FormState> }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.network, f.value])));
  const [state, setState] = useState<FormState | null>(null);
  const [pending, start] = useTransition();

  return (
    <form onSubmit={(e) => { e.preventDefault(); start(async () => setState(await save(values))); }} className="space-y-4">
      {fields.map((f) => (
        <div key={f.network}>
          <label htmlFor={`p-${f.network}`} className="block text-sm font-medium">{f.label} (optional)</label>
          <input
            id={`p-${f.network}`}
            type="url"
            inputMode="url"
            maxLength={300}
            placeholder="https://"
            value={values[f.network] ?? ""}
            onChange={(e) => setValues({ ...values, [f.network]: e.target.value })}
            aria-describedby={state?.fieldErrors?.[f.network] ? `e-${f.network}` : undefined}
            className="mt-1 block min-h-11 w-full rounded-md border border-neutral-400 bg-transparent px-3 text-base"
          />
          {state?.fieldErrors?.[f.network] && <p id={`e-${f.network}`} className="mt-1 text-sm text-red-800">{state.fieldErrors[f.network][0]}</p>}
        </div>
      ))}
      {state?.message && <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-green-900" : "text-red-900"}`}>{state.message}</p>}
      <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center rounded-md bg-neutral-900 px-5 text-sm font-medium text-white disabled:opacity-50">{pending ? "Saving…" : "Save links"}</button>
    </form>
  );
}

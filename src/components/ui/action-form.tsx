"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Field, TextArea, TextInput } from "@/components/ui/fields";

export interface FieldSpec {
  name: string;
  label: string;
  kind?: "text" | "email" | "url" | "textarea" | "select" | "date";
  options?: ReadonlyArray<{ value: string; label: string }>;
  hint?: string;
  maxLength?: number;
  required?: boolean;
}

type FormState = FormResult & { values?: Record<string, string> };

export interface FormResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

/** One plain form for the simple record screens: fields from a list, errors under each, server action underneath. */
export function ActionForm({ action, fields, defaults = {}, submitLabel, hidden = {}, compact = false }: {
  action: (previous: FormResult, formData: FormData) => Promise<FormResult>;
  fields: readonly FieldSpec[];
  defaults?: Record<string, string | undefined>;
  submitLabel: string;
  hidden?: Record<string, string>;
  compact?: boolean;
}) {
  // React resets uncontrolled fields after every submit; keep what was typed so an error does not wipe the form.
  const [state, formAction, pending] = useActionState(async (previous: FormState, formData: FormData): Promise<FormState> => {
    const values: Record<string, string> = {};
    for (const f of fields) { const v = formData.get(f.name); if (typeof v === "string") values[f.name] = v; }
    const result = await action(previous, formData);
    return { ...result, values: result.ok && !hidden.id ? {} : values };
  }, { ok: false } as FormState);
  const shown = (name: string) => state.values?.[name] ?? defaults[name];
  return (
    <form action={formAction} className={compact ? "grid gap-3 sm:grid-cols-2" : "space-y-4"} noValidate>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {fields.map((f) => {
        const error = state.fieldErrors?.[f.name]?.[0];
        const common = { name: f.name, defaultValue: shown(f.name) ?? "", required: f.required ?? false, maxLength: f.maxLength, "aria-invalid": error ? true : undefined } as const;
        return (
          <div key={f.name} className={f.kind === "textarea" ? "sm:col-span-2" : undefined}>
            <Field label={f.label} hint={f.hint} error={error}>
              {f.kind === "textarea" ? <TextArea {...common} rows={4} />
                : f.kind === "select" ? <Select name={f.name} defaultValue={shown(f.name) ?? f.options?.[0]?.value}>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                : <TextInput {...common} type={f.kind === "email" ? "email" : f.kind === "url" ? "url" : f.kind === "date" ? "date" : "text"} />}
            </Field>
          </div>
        );
      })}
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>{submitLabel}</Button>
        <p role="status" aria-live="polite" className={`text-sm ${state.ok ? "text-[#166534]" : "text-[#b42318]"}`}>{state.message ?? ""}</p>
      </div>
    </form>
  );
}

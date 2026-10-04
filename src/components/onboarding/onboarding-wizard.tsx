"use client";

import { useState, useTransition } from "react";
import type { FieldErrors } from "@/lib/validation/form";

interface Values {
  type: "agency" | "saas" | "";
  name: string;
  niche: string;
  audience: string;
  website: string;
  description: string;
}

interface ActionResult {
  ok: false;
  message?: string;
  fieldErrors?: FieldErrors;
}

type Action = (input: unknown) => Promise<ActionResult | undefined>;

const STEP_OF_FIELD: Record<string, 1 | 2> = {
  type: 1,
  name: 1,
  niche: 2,
  audience: 2,
  website: 2,
  description: 2,
};

const inputClass =
  "block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base outline-none focus-visible:border-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/20 dark:border-neutral-700 dark:focus-visible:border-neutral-100 dark:focus-visible:ring-neutral-100/20";
const primaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-neutral-900 px-5 py-2 text-base font-medium text-white outline-none hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300";
const secondaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 px-5 py-2 text-base font-medium outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-900 dark:border-neutral-700 dark:hover:bg-neutral-900";

const TYPE_LABELS = {
  agency: { title: "Agency", text: "I do work for clients and want proof of results." },
  saas: { title: "SaaS", text: "I sell software and want customer stories." },
} as const;

export function OnboardingWizard({ action }: { action: Action }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [values, setValues] = useState<Values>({ type: "", name: "", niche: "", audience: "", website: "", description: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  const set = (field: keyof Values) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  function goNext(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === 1 && values.type === "") {
      setErrors({ type: ["Choose one"] });
      return;
    }
    setErrors({});
    setStep((step + 1) as 2 | 3);
  }

  function submit() {
    setMessage(undefined);
    startTransition(async () => {
      // On success the server action redirects, so a returned value is always a failure.
      const result = await action({ ...values });
      if (!result) return;
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message);
      const firstField = Object.keys(result.fieldErrors ?? {})[0];
      if (firstField && STEP_OF_FIELD[firstField]) setStep(STEP_OF_FIELD[firstField]);
    });
  }

  const err = (field: string) => errors[field]?.[0];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Step {step} of 3</p>
        <div className="mt-2 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800" aria-hidden="true">
          <div className="h-full rounded-full bg-neutral-900 transition-all dark:bg-neutral-100" style={{ width: `${(step / 3) * 100}%` }} />
        </div>
      </div>

      {step === 1 && (
        <form onSubmit={goNext} className="space-y-5" noValidate>
          <h1 className="text-xl font-semibold">What kind of business do you run?</h1>
          <fieldset className="space-y-3">
            <legend className="sr-only">Business type</legend>
            {(Object.keys(TYPE_LABELS) as Array<keyof typeof TYPE_LABELS>).map((key) => (
              <label
                key={key}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-neutral-300 p-3 has-[:checked]:border-neutral-900 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-neutral-900 dark:border-neutral-700 dark:has-[:checked]:border-neutral-100"
              >
                <input
                  type="radio"
                  name="type"
                  value={key}
                  checked={values.type === key}
                  onChange={() => setValues((current) => ({ ...current, type: key }))}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">{TYPE_LABELS[key].title}</span>
                  <span className="block text-sm text-neutral-600 dark:text-neutral-400">{TYPE_LABELS[key].text}</span>
                </span>
              </label>
            ))}
            {err("type") && <p className="text-sm text-red-700 dark:text-red-400">{err("type")}</p>}
          </fieldset>
          <div className="space-y-1.5">
            <label htmlFor="name" className="block text-sm font-medium">Business name</label>
            <input id="name" value={values.name} onChange={set("name")} required maxLength={100} autoComplete="organization" className={inputClass} aria-invalid={err("name") ? true : undefined} />
            {err("name") && <p className="text-sm text-red-700 dark:text-red-400">{err("name")}</p>}
          </div>
          <button type="submit" className={primaryButton} onClick={() => values.name.trim() === "" && setErrors({ name: ["Enter your business name"] })}>
            Continue
          </button>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={goNext} className="space-y-5" noValidate>
          <h1 className="text-xl font-semibold">Tell us about what you do</h1>
          {(
            [
              ["niche", "Your niche", "For example: AI automation for dentists", 100],
              ["audience", "Who you serve", "For example: dental practice owners", 200],
            ] as const
          ).map(([field, label, hint, max]) => (
            <div key={field} className="space-y-1.5">
              <label htmlFor={field} className="block text-sm font-medium">{label}</label>
              <input id={field} value={values[field]} onChange={set(field)} required maxLength={max} className={inputClass} aria-describedby={`${field}-hint`} aria-invalid={err(field) ? true : undefined} />
              <p id={`${field}-hint`} className="text-sm text-neutral-600 dark:text-neutral-400">{hint}</p>
              {err(field) && <p className="text-sm text-red-700 dark:text-red-400">{err(field)}</p>}
            </div>
          ))}
          <div className="space-y-1.5">
            <label htmlFor="website" className="block text-sm font-medium">Website (optional)</label>
            <input id="website" type="url" value={values.website} onChange={set("website")} maxLength={2048} autoComplete="url" placeholder="https://" className={inputClass} aria-invalid={err("website") ? true : undefined} />
            {err("website") && <p className="text-sm text-red-700 dark:text-red-400">{err("website")}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="description" className="block text-sm font-medium">What do you sell, in one line?</label>
            <textarea id="description" value={values.description} onChange={set("description")} required maxLength={300} rows={2} className={inputClass} aria-invalid={err("description") ? true : undefined} />
            {err("description") && <p className="text-sm text-red-700 dark:text-red-400">{err("description")}</p>}
          </div>
          <div className="flex gap-3">
            <button type="button" className={secondaryButton} onClick={() => setStep(1)}>Back</button>
            <button
              type="submit"
              className={primaryButton}
              onClick={(event) => {
                const missing: FieldErrors = {};
                if (!values.niche.trim()) missing.niche = ["Tell us your niche"];
                if (!values.audience.trim()) missing.audience = ["Tell us who you serve"];
                if (!values.description.trim()) missing.description = ["Add a one-line description"];
                if (Object.keys(missing).length) {
                  event.preventDefault();
                  setErrors(missing);
                }
              }}
            >
              Continue
            </button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <h1 className="text-xl font-semibold">Check your details</h1>
          <dl className="divide-y divide-neutral-200 rounded-md border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
            {(
              [
                ["Type", values.type ? TYPE_LABELS[values.type].title : ""],
                ["Business name", values.name],
                ["Niche", values.niche],
                ["Audience", values.audience],
                ["Website", values.website || "Not provided"],
                ["Description", values.description],
              ] as const
            ).map(([term, value]) => (
              <div key={term} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-4">
                <dt className="w-32 shrink-0 text-neutral-600 dark:text-neutral-400">{term}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>
          <div aria-live="polite" role="status">
            {message ? <p className="rounded-md border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">{message}</p> : null}
          </div>
          <div className="flex gap-3">
            <button type="button" className={secondaryButton} onClick={() => setStep(2)} disabled={pending}>Back</button>
            <button type="button" className={primaryButton} onClick={submit} disabled={pending}>
              {pending ? "Creating..." : "Create workspace"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

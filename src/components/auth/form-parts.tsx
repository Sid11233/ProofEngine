"use client";

import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/validation/form";

const inputClass =
  "block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base outline-none focus-visible:border-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/20 dark:border-neutral-700 dark:focus-visible:border-neutral-100 dark:focus-visible:ring-neutral-100/20";

export function TextField({
  label,
  name,
  type = "text",
  autoComplete,
  errors,
  hint,
  required = true,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: "text" | "email" | "password" | "url";
  autoComplete?: string;
  errors?: string[];
  hint?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={[errors?.length ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined}
        className={inputClass}
      />
      {hint && (
        <p id={hintId} className="text-sm text-neutral-600 dark:text-neutral-400">
          {hint}
        </p>
      )}
      {errors?.length ? (
        <p id={errorId} className="text-sm text-red-700 dark:text-red-400">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({ children, pendingLabel }: { children: React.ReactNode; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-base font-medium text-white outline-none hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300 dark:focus-visible:ring-neutral-100"
    >
      {pending ? (pendingLabel ?? "Working...") : children}
    </button>
  );
}

export function FormMessage({ state }: { state: FormState | undefined }) {
  // Always rendered so screen readers announce changes to it.
  return (
    <div aria-live="polite" role="status">
      {state?.message ? (
        <p
          className={
            state.ok
              ? "rounded-md border border-green-700/30 bg-green-50 px-3 py-2 text-sm text-green-900 dark:bg-green-950 dark:text-green-100"
              : "rounded-md border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
          }
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

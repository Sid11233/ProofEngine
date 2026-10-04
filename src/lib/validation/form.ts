import { z } from "zod";

export type FieldErrors = Record<string, string[]>;

/** Result shape shared by every form-backed server action. */
export interface FormState {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
  /** The action needs a fresh sign-in first; says which kind of proof to ask for. */
  reauth?: "password" | "mfa" | "oauth";
}

/**
 * Pulls only the named string fields out of a FormData. Next.js adds hidden
 * `$ACTION_*` fields to server-action forms, and anything else a client sends is
 * ignored here rather than trusted.
 */
export function formDataToObject(formData: FormData, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = formData.get(key);
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function fieldErrorsOf(error: z.ZodError): FieldErrors {
  return z.flattenError(error).fieldErrors as FieldErrors;
}

"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/validation/form";
import { FormMessage, SubmitButton, TextField } from "./form-parts";

export function MfaLoginForm({
  action,
  next,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  next?: string;
}) {
  const [state, formAction] = useActionState(action, undefined as unknown as FormState);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <TextField
        label="6-digit code"
        name="code"
        autoComplete="one-time-code"
        inputMode="numeric"
        errors={state?.fieldErrors?.code}
      />
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Checking...">Verify</SubmitButton>
    </form>
  );
}

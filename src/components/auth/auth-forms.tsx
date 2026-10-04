"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/validation/form";
import { FormMessage, SubmitButton, TextField } from "./form-parts";

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;

export function LoginForm({ action, next }: { action: Action; next?: string }) {
  const [state, formAction] = useActionState(action, undefined as unknown as FormState);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <TextField label="Email" name="email" type="email" autoComplete="email" errors={state?.fieldErrors?.email} />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        errors={state?.fieldErrors?.password}
      />
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Signing in...">Sign in</SubmitButton>
    </form>
  );
}

export function SignupForm({ action, next }: { action: Action; next?: string }) {
  const [state, formAction] = useActionState(action, undefined as unknown as FormState);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <TextField label="Your name" name="fullName" autoComplete="name" errors={state?.fieldErrors?.fullName} />
      <TextField label="Work email" name="email" type="email" autoComplete="email" errors={state?.fieldErrors?.email} />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters."
        errors={state?.fieldErrors?.password}
      />
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Creating account...">Create account</SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, undefined as unknown as FormState);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <TextField label="Email" name="email" type="email" autoComplete="email" errors={state?.fieldErrors?.email} />
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Sending...">Send reset link</SubmitButton>
    </form>
  );
}

export function ResetPasswordForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, undefined as unknown as FormState);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <TextField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters."
        errors={state?.fieldErrors?.password}
      />
      <TextField
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        errors={state?.fieldErrors?.confirmPassword}
      />
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving...">Update password</SubmitButton>
    </form>
  );
}

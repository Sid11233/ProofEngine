"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { reauthMfaAction, reauthPasswordAction, signInWithGoogleAction } from "@/app/(auth)/actions";
import type { FormState } from "@/lib/validation/form";
import { FormMessage, SubmitButton, TextField } from "./form-parts";

type Needed = "password" | "mfa" | "oauth";

/**
 * Asks the user to prove it is still them before a sensitive action: password,
 * then an authenticator code if they use two-factor, or Google again for OAuth-only
 * accounts. Calls `onDone` once they have, so the caller can retry the action.
 */
export function ReauthPrompt({ needed, onDone }: { needed: Needed; onDone: () => void }) {
  const [stage, setStage] = useState<Needed>(needed);
  const pathname = usePathname();

  const [passwordState, passwordAction] = useActionState(reauthPasswordAction, undefined as unknown as FormState);
  const [mfaState, mfaAction] = useActionState(reauthMfaAction, undefined as unknown as FormState);

  // The caller's callback changes on every render; keep the latest in a ref and
  // fire it exactly once, so the sensitive action is never retried in a loop.
  const onDoneRef = useRef(onDone);
  const doneRef = useRef(false);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    if (passwordState?.ok && !doneRef.current) {
      doneRef.current = true;
      onDoneRef.current();
    } else if (passwordState?.reauth) {
      setStage(passwordState.reauth);
    }
  }, [passwordState]);

  useEffect(() => {
    if (mfaState?.ok && !doneRef.current) {
      doneRef.current = true;
      onDoneRef.current();
    }
  }, [mfaState]);

  return (
    <div role="group" aria-label="Confirm it is you" className="space-y-3 rounded-md border border-neutral-300 p-4 dark:border-neutral-700">
      <p className="text-sm font-medium">For your security, confirm it is you.</p>

      {stage === "password" && (
        <form action={passwordAction} className="space-y-3" noValidate>
          <TextField label="Password" name="password" type="password" autoComplete="current-password" errors={passwordState?.fieldErrors?.password} />
          <FormMessage state={passwordState} />
          <SubmitButton pendingLabel="Checking...">Confirm</SubmitButton>
        </form>
      )}

      {stage === "mfa" && (
        <form action={mfaAction} className="space-y-3" noValidate>
          <TextField label="6-digit code" name="code" autoComplete="one-time-code" inputMode="numeric" errors={mfaState?.fieldErrors?.code} />
          <FormMessage state={mfaState ?? passwordState} />
          <SubmitButton pendingLabel="Checking...">Confirm</SubmitButton>
        </form>
      )}

      {stage === "oauth" && (
        <form action={signInWithGoogleAction}>
          <input type="hidden" name="next" value={pathname} />
          <SubmitButton>Continue with Google</SubmitButton>
        </form>
      )}
    </div>
  );
}

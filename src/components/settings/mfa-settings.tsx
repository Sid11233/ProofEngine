"use client";

import { useState, useTransition } from "react";
import { ReauthPrompt } from "@/components/auth/reauth-prompt";
import type { EnrollResult } from "@/app/app/settings/security/actions";
import type { FormState } from "@/lib/validation/form";
import { brand } from "@/lib/brand";

interface Props {
  verifiedFactorId: string | null;
  start: () => Promise<EnrollResult>;
  confirm: (factorId: string, code: string) => Promise<FormState>;
  disable: (factorId: string) => Promise<FormState>;
}

const button =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 px-4 py-2 text-base font-medium outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-900 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-900";
const primary =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-base font-medium text-white outline-none hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900";

export function MfaSettings({ verifiedFactorId, start, confirm, disable }: Props) {
  const [factorId, setFactorId] = useState(verifiedFactorId);
  const [enrolling, setEnrolling] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [reauth, setReauth] = useState<"password" | "mfa" | "oauth" | null>(null);
  const [pending, startTransition] = useTransition();

  function begin() {
    setError(undefined);
    setMessage(undefined);
    startTransition(async () => {
      const result = await start();
      if (result.ok) setEnrolling(result);
      else setError(result.message);
    });
  }

  function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrolling) return;
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    setError(undefined);
    startTransition(async () => {
      const result = await confirm(enrolling.factorId, code);
      if (result.ok) {
        setFactorId(enrolling.factorId);
        setEnrolling(null);
        setMessage(result.message);
      } else {
        setError(result.fieldErrors?.code?.[0] ?? result.message);
      }
    });
  }

  function turnOff() {
    if (!factorId) return;
    setError(undefined);
    setMessage(undefined);
    startTransition(async () => {
      const result = await disable(factorId);
      if (result.ok) {
        setFactorId(null);
        setReauth(null);
        setMessage(result.message);
      } else if (result.reauth) {
        setReauth(result.reauth);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <section aria-labelledby="mfa-heading" className="space-y-4">
      <h2 id="mfa-heading" className="text-lg font-semibold">Two-factor authentication</h2>

      <div aria-live="polite" role="status" className="space-y-2">
        {message && <p className="rounded-md border border-green-700/30 bg-green-50 px-3 py-2 text-sm text-green-900 dark:bg-green-950 dark:text-green-100">{message}</p>}
        {error && <p className="rounded-md border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">{error}</p>}
      </div>

      {!factorId && !enrolling && (
        <>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Add a second step to sign-in with an authenticator app such as 1Password, Authy or Google Authenticator.
          </p>
          <button type="button" className={primary} onClick={begin} disabled={pending}>
            {pending ? "Starting..." : "Turn on two-factor authentication"}
          </button>
        </>
      )}

      {enrolling && (
        <form onSubmit={verify} className="space-y-4" noValidate>
          <p className="text-sm">1. Scan this code with your authenticator app.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrolling.qrCode} alt={`QR code to add ${brand.name} to your authenticator app`} width={192} height={192} className="rounded-md border border-neutral-200 bg-white p-2" />
          <p className="text-sm">
            Cannot scan? Enter this key instead:{" "}
            <code data-testid="mfa-secret" className="break-all rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-900">{enrolling.secret}</code>
          </p>
          <div className="space-y-1.5">
            <label htmlFor="mfa-code" className="block text-sm font-medium">2. Enter the 6-digit code it shows</label>
            <input id="mfa-code" name="code" inputMode="numeric" autoComplete="one-time-code" required className="block w-full max-w-48 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 dark:border-neutral-700" />
          </div>
          <div className="flex gap-3">
            <button type="submit" className={primary} disabled={pending}>{pending ? "Checking..." : "Verify and turn on"}</button>
            <button type="button" className={button} onClick={() => setEnrolling(null)} disabled={pending}>Cancel</button>
          </div>
        </form>
      )}

      {factorId && !enrolling && (
        <div className="space-y-3">
          <p className="text-sm">Two-factor authentication is <strong>on</strong>. You will be asked for a code each time you sign in.</p>
          {reauth ? (
            <ReauthPrompt needed={reauth} onDone={turnOff} />
          ) : (
            <button type="button" className={button} onClick={turnOff} disabled={pending}>Turn off two-factor authentication</button>
          )}
        </div>
      )}
    </section>
  );
}

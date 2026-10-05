"use client";

import { useState } from "react";
import { TurnstileWidget } from "@/components/turnstile-widget";

interface Props {
  workspace: string;
  slug: string;
  turnstileSiteKey?: string;
  nonce?: string;
  submit: (input: unknown) => Promise<{ ok: boolean; message?: string }>;
}

const field = "block w-full rounded-md border border-neutral-400 bg-white px-3 py-2 text-base text-neutral-900";

export function ReportForm({ workspace, slug, turnstileSiteKey, nonce, submit }: Props) {
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  const [human, setHuman] = useState<string>();
  const [state, setState] = useState<{ ok: boolean; message?: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setState(await submit({ workspace, slug, reason, email, turnstileToken: human }));
    setPending(false);
  }

  if (state?.ok) {
    return <p role="status" className="rounded-md border border-green-700/30 bg-green-50 p-4 text-green-950">Thank you. We have passed your report to the people who run this page, and to the platform team. We will reply to the email you gave.</p>;
  }

  return (
    <form onSubmit={send} className="space-y-4">
      {state && !state.ok ? <p role="alert" className="rounded-md border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-900">{state.message}</p> : null}
      <div className="space-y-1">
        <label htmlFor="report-reason" className="block text-sm font-medium">What is wrong with this page?</label>
        <textarea id="report-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={5} maxLength={2000} required className={field} />
      </div>
      <div className="space-y-1">
        <label htmlFor="report-email" className="block text-sm font-medium">Your email (so we can reply)</label>
        <input id="report-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} required className={field} />
      </div>
      {turnstileSiteKey ? <TurnstileWidget siteKey={turnstileSiteKey} nonce={nonce} onToken={setHuman} /> : null}
      <button type="submit" disabled={pending || Boolean(turnstileSiteKey && !human)} className="inline-flex min-h-12 items-center rounded-md bg-neutral-900 px-5 font-medium text-white disabled:opacity-50">Send report</button>
    </form>
  );
}

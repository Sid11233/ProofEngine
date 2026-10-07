"use client";

import { useEffect, useRef, useState } from "react";
import { CONSENT_LABEL } from "@/lib/demos/public-schemas";
import type { DemoContent, DemoSettings, DemoTheme } from "@/lib/demos/schema";
import { DemoPlayer } from "./demo-player";

// The public page around the player: optional lead form, call to action, privacy-light beacons. It uses no
// cookies and no storage. Every beacon carries only an event type and a step number.

type Beacon = "view" | "step" | "complete" | "cta_click";
const base = (slug: string) => `/demo/${slug}`;

function beacon(slug: string, type: Beacon, step?: number) {
  void fetch(`${base(slug)}/event`, {
    method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true, credentials: "omit",
    body: JSON.stringify(step === undefined ? { type } : { type, step }),
  }).catch(() => undefined);
}

const input = "block w-full rounded-md border border-neutral-400 bg-white px-3 py-2 text-base text-neutral-900";

function LeadForm({ slug, step, onDone }: { slug: string; step: number; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base(slug)}/lead`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit",
        body: JSON.stringify({ email, ...(name ? { name } : {}), consent, step_reached: step, ...(company ? { company } : {}) }),
      });
      if (res.ok) onDone();
      else setError(res.status === 429 ? "Too many tries. Please wait a few minutes." : "Please check your email address and tick the box.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-md space-y-3 text-left">
      <label className="block text-sm font-medium">Your email<input type="email" required autoComplete="email" maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} className={`${input} mt-1`} /></label>
      <label className="block text-sm font-medium">Your name (optional)<input type="text" autoComplete="name" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className={`${input} mt-1`} /></label>
      <div aria-hidden="true" className="absolute -left-[9999px]"><label>Company<input tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} /></label></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-4" /><span>{CONSENT_LABEL}</span></label>
      {error ? <p role="alert" className="text-sm text-[#b42318]">{error}</p> : null}
      <button type="submit" disabled={busy} className="rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Sending…" : "Continue"}</button>
    </form>
  );
}

export function PublicDemo({ slug, title, content, theme, settings, assetBase, badge, reportHref, embedded }: {
  slug: string; title: string; content: DemoContent; theme: DemoTheme; settings: DemoSettings; assetBase: string;
  badge: { href: string; name: string } | null; reportHref: string; embedded: boolean;
}) {
  const [started, setStarted] = useState(settings.lead_gate !== "start");
  const [leadDone, setLeadDone] = useState(false);
  const [reached, setReached] = useState(0);
  const viewed = useRef(false);

  // One view per page load: when the player appears (after the form, if the gate is at the start).
  useEffect(() => {
    if (started && !viewed.current) { viewed.current = true; beacon(slug, "view"); }
  }, [started, slug]);

  const cta = settings.cta_url && settings.cta_text ? (
    <a href={settings.cta_url} target="_blank" rel="noopener noreferrer nofollow" onClick={() => beacon(slug, "cta_click")} className="inline-block rounded-full px-6 py-3 text-sm font-semibold text-white no-underline" style={{ background: theme.primary }}>{settings.cta_text}</a>
  ) : null;
  const end = settings.lead_gate === "end" && !leadDone
    ? <LeadForm slug={slug} step={reached} onDone={() => setLeadDone(true)} />
    : cta;

  return (
    <main className={`mx-auto w-full max-w-3xl space-y-4 px-4 ${embedded ? "py-3" : "py-10"}`}>
      {embedded ? null : <h1 className="text-2xl font-semibold">{title}</h1>}
      {!started ? (
        <div className="rounded-2xl border border-neutral-300 bg-white p-6">
          <p className="mb-4 text-neutral-700">Enter your email to watch the demo.</p>
          <LeadForm slug={slug} step={0} onDone={() => { setLeadDone(true); setStarted(true); }} />
        </div>
      ) : (
        <DemoPlayer
          content={content} theme={theme} assetSrc={(id) => `${assetBase}/${id}`} end={end}
          onStep={(i) => { setReached(i); beacon(slug, "step", i); }}
          onComplete={() => beacon(slug, "complete")}
        />
      )}
      <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600">
        {badge ? <a href={badge.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Made with {badge.name}</a> : <span />}
        <a href={reportHref} target={embedded ? "_blank" : undefined} rel="noopener noreferrer" className="underline underline-offset-2">Report this demo</a>
      </footer>
    </main>
  );
}

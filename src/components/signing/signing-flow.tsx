"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import type { SignState } from "@/app/sign/[token]/actions";
import { diffWords } from "@/lib/case-study/diff";
import { SignaturePad } from "./signature-pad";

export interface ReviewProps {
  version: number;
  workspaceName: string;
  claims: Array<{ id: string; text: string; sourceQuote: string; edited: boolean }>;
  changes: Array<{ label: string; before: string | null; after: string; kind: "rewritten" | "edited_quote" | "edited_number" }>;
  consent: { version: string; body: string };
  prefill: { signerName: string; company: string; role: string; displayChoice: "full" | "first_only" | "anonymous" };
}

interface Props {
  stage: "identity" | "review";
  workspaceName: string;
  maskedEmail?: string;
  review?: ReviewProps;
  /** The exact final version, rendered on the server. */
  preview?: ReactNode;
  /** The client's own "remove my story" link. */
  removalUrl?: string;
  actions: {
    sendCode: () => Promise<SignState>;
    verifyCode: (input: unknown) => Promise<SignState>;
    sign: (input: unknown) => Promise<SignState>;
    requestChanges: (input: unknown) => Promise<SignState>;
    decline: () => Promise<SignState>;
  };
}

const button = "inline-flex min-h-12 items-center justify-center rounded-md px-5 text-base font-medium outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 disabled:opacity-50";
const primary = `${button} bg-neutral-900 text-white`;
const secondary = `${button} border border-neutral-400`;
const input = "block min-h-12 w-full rounded-md border border-neutral-400 bg-transparent px-3 text-base";
const alertBox = "rounded-md border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-900";

const DONE = {
  signed: "Thank you. You signed and approved this case study. We emailed you a copy of the signed record. It only goes live when the team publishes it, and you can withdraw your consent at any time using the link in that email.",
  changes: "Thank you. We sent your note to the team. They will update the case study and send you a new link.",
  declined: "Understood. This case study will not be published.",
} as const;

export function SigningFlow({ stage, workspaceName, maskedEmail, review, preview, removalUrl: removalLink, actions }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [done, setDone] = useState<keyof typeof DONE | null>(null);
  const [removalUrl, setRemovalUrl] = useState<string | null>(null);

  const [name, setName] = useState(review?.prefill.signerName ?? "");
  const [company, setCompany] = useState(review?.prefill.company ?? "");
  const [role, setRole] = useState(review?.prefill.role ?? "");
  const [displayChoice, setDisplayChoice] = useState(review?.prefill.displayChoice ?? "first_only");
  const [esign, setEsign] = useState(false);
  const [accuracy, setAccuracy] = useState(false);
  const [social, setSocial] = useState(false);
  const [media, setMedia] = useState(false);
  const [method, setMethod] = useState<"drawn" | "typed">("drawn");
  const [drawn, setDrawn] = useState<string | null>(null);
  const [mode, setMode] = useState<"sign" | "changes" | "decline">("sign");
  const [note, setNote] = useState("");

  const run = (fn: () => Promise<SignState>, onOk: (state: SignState) => void) =>
    start(async () => {
      setMessage(null);
      const state = await fn();
      if (state.ok) onOk(state);
      else setMessage(state.message ?? "Something went wrong.");
    });

  if (done) {
    return (
      <div className="space-y-3">
        <p role="status" className="rounded-md border border-green-700/30 bg-green-50 p-4 text-green-950">{DONE[done]}</p>
        {done === "declined" && removalUrl && <p className="text-sm">Want everything about this removed? <a href={removalUrl} className="underline underline-offset-2">Delete this story and my interview</a>.</p>}
      </div>
    );
  }

  if (stage === "identity") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Review and sign your case study</h1>
        <p className="text-neutral-700">{workspaceName ? `${workspaceName} wrote` : "We wrote"} a short case study from what you told them. First, confirm it is you: we will email a 6 digit code to {maskedEmail}.</p>
        {message && <p role="alert" className={alertBox}>{message}</p>}
        {!codeSent ? (
          <button type="button" disabled={pending} className={primary} onClick={() => run(actions.sendCode, () => setCodeSent(true))}>Email me a code</button>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => actions.verifyCode({ code }), () => router.refresh()); }}>
            <label htmlFor="code" className="block text-sm font-medium">Code from the email</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={`${input} tracking-widest`} required />
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={pending || code.length !== 6} className={primary}>Continue</button>
              <button type="button" disabled={pending} className={secondary} onClick={() => run(actions.sendCode, () => setMessage("We sent a new code."))}>Send a new code</button>
            </div>
            <p className="text-sm text-neutral-600">The code works for 10 minutes.</p>
          </form>
        )}
      </div>
    );
  }

  if (!review) return null;
  const typedOk = method === "typed" && name.trim().length >= 2;
  const canSign = esign && accuracy && name.trim().length >= 2 && (method === "typed" ? typedOk : drawn !== null) && !pending;

  const submit = () =>
    run(
      () => actions.sign({ signerName: name, company: company || undefined, role: role || undefined, displayChoice, esignDisclosure: esign, confirmAccuracy: accuracy, consentSocial: social, consentMedia: media, method, ...(method === "drawn" && drawn ? { signatureImage: drawn } : {}), expectedVersion: review.version }),
      () => setDone("signed"),
    );

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Please review and sign</h1>
        <p className="text-neutral-700">{review.workspaceName ? `${review.workspaceName} wrote` : "We wrote"} the page below from what you told us. Nothing is published unless you sign, and you can ask for changes or say no.</p>
      </header>

      <section aria-labelledby="s-preview" className="space-y-3">
        <h2 id="s-preview" className="text-lg font-semibold">1. The exact page</h2>
        <div className="overflow-hidden rounded-md border border-neutral-300">{preview}</div>
      </section>

      <section aria-labelledby="s-claims" className="space-y-3">
        <h2 id="s-claims" className="text-lg font-semibold">What you said</h2>
        <ul className="space-y-2">
          {review.claims.map((claim) => (
            <li key={claim.id} className="rounded-md border border-neutral-300 p-3 text-sm">
              <p>{claim.text}</p>
              <p className="mt-1 text-neutral-600">You said: “{claim.sourceQuote}”</p>
            </li>
          ))}
        </ul>
      </section>

      {review.changes.length > 0 && (
        <section aria-labelledby="s-changes" className="space-y-3 rounded-md border border-amber-600/40 bg-amber-50 p-4">
          <h2 id="s-changes" className="text-lg font-semibold">What we changed from your words</h2>
          <ul className="space-y-4">
            {review.changes.map((change, i) => (
              <li key={i} className="space-y-1 text-sm">
                <p className="font-medium">{change.label}</p>
                {change.kind === "rewritten" && change.before !== null ? (
                  <p className="whitespace-pre-wrap">
                    {diffWords(change.before, change.after).map((part, j) => <span key={j} className={part.kind === "removed" ? "bg-red-100 line-through" : part.kind === "added" ? "bg-green-100" : undefined}>{part.text}</span>)}
                  </p>
                ) : (
                  <p className="whitespace-pre-wrap"><mark className="bg-amber-200">{change.after}</mark>{change.before ? <span className="block text-neutral-700">You said: “{change.before}”</span> : null}</p>
                )}
                <p className="text-xs text-neutral-700">{change.kind === "rewritten" ? "Reworded by the team." : change.kind === "edited_quote" ? "This quote is not word for word what you said." : "This number is not what you said."}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="s-consent" className="space-y-3">
        <h2 id="s-consent" className="text-lg font-semibold">2. Your agreement</h2>
        <div tabIndex={0} role="region" aria-label="Consent text" className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-neutral-300 p-3 text-sm">{review.consent.body}</div>
        <p className="text-xs text-neutral-600">Version {review.consent.version}</p>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-5" checked={esign} onChange={(e) => setEsign(e.target.checked)} /><span>Required: I agree to do business electronically and to sign this record with an electronic signature.</span></label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-5" checked={accuracy} onChange={(e) => setAccuracy(e.target.checked)} /><span>Required: I confirm the page above is accurate and I allow it to be published on the web.</span></label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-5" checked={social} onChange={(e) => setSocial(e.target.checked)} /><span>Optional: the team may share it on social media.</span></label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-5" checked={media} onChange={(e) => setMedia(e.target.checked)} /><span>Optional: the team may use my company logo and headshot.</span></label>
      </section>

      <section aria-labelledby="s-sign" className="space-y-4">
        <h2 id="s-sign" className="text-lg font-semibold">3. Sign</h2>
        {message && <p role="alert" className={alertBox}>{message}</p>}
        {mode === "sign" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="n" className="block text-sm font-medium">Full name</label><input id="n" className={input} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
              <div><label htmlFor="d" className="block text-sm font-medium">How should your name appear?</label>
                <select id="d" className={input} value={displayChoice} onChange={(e) => setDisplayChoice(e.target.value as typeof displayChoice)}>
                  <option value="full">Full name</option><option value="first_only">First name only</option><option value="anonymous">Anonymous</option>
                </select></div>
              <div><label htmlFor="c" className="block text-sm font-medium">Company (optional)</label><input id="c" className={input} value={company} maxLength={200} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" /></div>
              <div><label htmlFor="r" className="block text-sm font-medium">Role (optional)</label><input id="r" className={input} value={role} maxLength={200} onChange={(e) => setRole(e.target.value)} autoComplete="organization-title" /></div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Signature</legend>
              <div className="flex gap-4 text-sm">
                <label className="flex min-h-11 items-center gap-2"><input type="radio" name="m" checked={method === "drawn"} onChange={() => setMethod("drawn")} /> Draw</label>
                <label className="flex min-h-11 items-center gap-2"><input type="radio" name="m" checked={method === "typed"} onChange={() => setMethod("typed")} /> Type my name</label>
              </div>
              {method === "drawn" ? <SignaturePad onChange={setDrawn} disabled={pending} /> : <p className="rounded-md border border-neutral-300 p-3 text-xl italic">{name || "Your name"}</p>}
            </fieldset>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button type="button" disabled={!canSign} className={primary} onClick={submit}>Sign and approve</button>
              <button type="button" disabled={pending} className={secondary} onClick={() => setMode("changes")}>Request changes</button>
              <button type="button" disabled={pending} className={secondary} onClick={() => setMode("decline")}>Decline and remove</button>
            </div>
          </>
        )}
        {mode === "changes" && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => actions.requestChanges({ note }), () => setDone("changes")); }}>
            <label htmlFor="note" className="block text-sm font-medium">What should change? ({note.length}/1000)</label>
            <textarea id="note" rows={4} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="block w-full rounded-md border border-neutral-400 bg-transparent px-3 py-2 text-base" required />
            <div className="flex gap-3"><button type="submit" disabled={pending || note.trim() === ""} className={primary}>Send to the team</button><button type="button" className={secondary} onClick={() => setMode("sign")}>Back</button></div>
          </form>
        )}
        {mode === "decline" && (
          <div className="space-y-3">
            <p className="text-sm">The team will not be able to publish this story, and you can delete your interview afterwards. This cannot be undone.</p>
            <div className="flex gap-3">
              <button type="button" disabled={pending} className={`${button} bg-red-800 text-white`} onClick={() => run(actions.decline, (s) => { setRemovalUrl(s.removalUrl ?? null); setDone("declined"); })}>Yes, decline</button>
              <button type="button" className={secondary} onClick={() => setMode("sign")}>Back</button>
            </div>
          </div>
        )}
        {removalLink && <p className="text-sm text-neutral-600">Want everything about this removed instead? <a href={removalLink} className="underline underline-offset-2">Delete this story and my interview</a>.</p>}
      </section>
    </div>
  );
}

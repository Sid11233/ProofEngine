"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MAX_VOICE_SECONDS, VOICE_CONSENT_TEXT, VOICE_CONSENT_VERSION } from "@/lib/interview/voice-constants";

const MIME_CHOICES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
type Phase = "idle" | "notice" | "recording" | "sending";

const button = "inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 px-4 text-base font-medium outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 disabled:opacity-50 dark:border-neutral-700";

/**
 * Record an answer by voice. The recording is sent to the server, which turns it into text; the text lands in the answer
 * box so the client can read and correct it before sending. Nothing is sent until the client presses the button.
 */
export function VoiceRecorder({ token, disabled, onText }: { token: string; disabled: boolean; onText: (text: string, voiceId: string) => void }) {
  // Browser capability: false on the server and during hydration, then the real answer (no state set in an effect).
  const supported = useSyncExternalStore(() => () => undefined, () => Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined", () => false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string>();
  const [agreed, setAgreed] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => { if (timer.current) clearInterval(timer.current); stream.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  if (!supported) return null;

  const release = () => { if (timer.current) clearInterval(timer.current); stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };

  async function start() {
    setError(undefined);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const mimeType = MIME_CHOICES.find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
      chunks.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
      rec.onstop = () => void send(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }));
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setPhase("recording");
      timer.current = setInterval(() => setSeconds((s) => { if (s + 1 >= MAX_VOICE_SECONDS) recorder.current?.stop(); return s + 1; }), 1000);
    } catch {
      release();
      setPhase("idle");
      setError("We could not use your microphone. Please allow it in your browser, or type your answer.");
    }
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
    release();
    setPhase("sending");
  }

  async function send(blob: Blob) {
    const body = new FormData();
    body.set("token", token);
    body.set("consentVersion", VOICE_CONSENT_VERSION);
    body.set("audio", new File([blob], "answer", { type: blob.type }));
    try {
      const res = await fetch("/api/interview/voice", { method: "POST", body, credentials: "omit", referrerPolicy: "no-referrer" });
      const data = (await res.json().catch(() => ({}))) as { text?: string; voiceId?: string; message?: string };
      if (!res.ok || !data.text || !data.voiceId) setError(data.message ?? "The recording did not work. Please try again, or type your answer.");
      else onText(data.text, data.voiceId);
    } catch {
      setError("The recording did not work. Please try again, or type your answer.");
    }
    setPhase("idle");
  }

  return (
    <div className="space-y-2">
      {phase === "idle" ? <button type="button" className={button} disabled={disabled} onClick={() => (agreed ? void start() : setPhase("notice"))}>Answer by voice</button> : null}
      {phase === "notice" ? (
        <div className="space-y-2 rounded-md border border-neutral-300 p-3 text-sm dark:border-neutral-700" role="group" aria-label="About voice answers">
          <p>{VOICE_CONSENT_TEXT}</p>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />I understand</label>
          <div className="flex gap-2">
            <button type="button" className={button} disabled={!agreed} onClick={() => void start()}>Start recording</button>
            <button type="button" className={button} onClick={() => setPhase("idle")}>Cancel</button>
          </div>
        </div>
      ) : null}
      {phase === "recording" ? (
        <div className="flex items-center gap-3" role="status" aria-live="polite">
          <span aria-hidden="true" className="size-3 animate-pulse rounded-full bg-red-600" />
          <span className="text-base">Recording {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} of {Math.floor(MAX_VOICE_SECONDS / 60)}:00</span>
          <button type="button" className={button} onClick={stop}>Stop</button>
        </div>
      ) : null}
      {phase === "sending" ? <p role="status" aria-live="polite" className="text-base">Writing it out…</p> : null}
      {error ? <p role="alert" className="text-sm text-red-900 dark:text-red-100">{error}</p> : null}
    </div>
  );
}

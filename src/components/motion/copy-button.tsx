"use client";

import { useEffect, useRef, useState } from "react";

/**
 * G-39 Copy confirm: after a click the icon becomes a drawn check and the label says "Copied" for 1.5 s, announced
 * politely to screen readers. Reduced motion: the text swap only (the check appears without drawing).
 */
export function CopyButton({ text, label = "Copy", className = "", onError }: { text: string; label?: string; className?: string; onError?: (message: string) => void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      onError?.("Your browser blocked copying. Select the text and copy it yourself.");
    }
  }

  return (
    <button type="button" data-anim="G-39" onClick={copy} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-neutral-400 px-4 text-sm font-medium ${className}`.trim()}>
      <svg key={copied ? "check" : "copy"} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {copied ? <path className="anim-draw" d="M5 13l4 4L19 7" /> : <path d="M9 9h10v11H9zM5 15V4h10" />}
      </svg>
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}

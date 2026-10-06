import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonPhase = "idle" | "loading" | "success";

/**
 * G-16 Button loading to success: while working the label fades and a ring spinner shows; on success a check draws for
 * a moment, then the label returns. The button keeps its width. Reduced motion: the label swaps to text ("Working…",
 * "Done") with no spinning or drawing (the CSS safety net stops them). Pure CSS, so it is safe on every route.
 */
export function LoadingButton({ phase, children, workingLabel = "Working…", doneLabel = "Done", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { phase: ButtonPhase; children: ReactNode; workingLabel?: string; doneLabel?: string }) {
  const busy = phase !== "idle";
  return (
    <button {...props} data-anim="G-16" aria-busy={phase === "loading"} disabled={props.disabled || phase === "loading"} className={`relative inline-flex items-center justify-center ${className}`.trim()}>
      <span className={busy ? "opacity-0" : ""} style={{ transition: "opacity var(--motion-micro) var(--ease-standard)" }}>{children}</span>
      {busy && (
        <span className="absolute inset-0 flex items-center justify-center gap-2" aria-hidden="true">
          {phase === "loading" ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="anim-spin"><path d="M12 3a9 9 0 019 9" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path className="anim-draw" d="M5 13l4 4L19 7" /></svg>
          )}
        </span>
      )}
      <span className="sr-only" role="status">{phase === "loading" ? workingLabel : phase === "success" ? doneLabel : ""}</span>
    </button>
  );
}

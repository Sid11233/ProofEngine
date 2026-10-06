import type { ButtonHTMLAttributes } from "react";

/**
 * G-15 Button press: scale 0.97 for 90 ms, spring back on release. Pure CSS (the .anim-press class in globals.css),
 * so it works on every route including /i and /sign. Reduced motion: none (the class does nothing then).
 */
export function PressableButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} data-anim="G-15" className={`anim-press ${className}`.trim()} />;
}

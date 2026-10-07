import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export const FIELD = "block min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2 text-sm";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export const TextInput = (props: InputHTMLAttributes<HTMLInputElement>) => <input type="text" {...props} className={`${FIELD} ${props.className ?? ""}`} />;
export const TextArea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...props} className={`${FIELD} ${props.className ?? ""}`} />;

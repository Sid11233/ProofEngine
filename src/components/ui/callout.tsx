import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

const TONES = {
  warn: { box: "border-[#f3e2a9] bg-[#fff8e6]", icon: "text-[#8a5a00]", name: "shield" as IconName },
  info: { box: "border-line bg-surface", icon: "text-muted", name: "bell" as IconName },
  tint: { box: "border-[#fbd9c8] bg-tint", icon: "text-signal", name: "shield" as IconName },
};

/** A note with an icon: rules warnings, notices. */
export function Callout({ tone = "warn", icon, children, className = "" }: { tone?: keyof typeof TONES; icon?: IconName; children: ReactNode; className?: string }) {
  const look = TONES[tone];
  return (
    <div role="note" className={`flex items-start gap-3 rounded-card border px-4 py-3 text-sm ${look.box} ${className}`.trim()}>
      <Icon name={icon ?? look.name} size={18} className={`mt-0.5 ${look.icon}`} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

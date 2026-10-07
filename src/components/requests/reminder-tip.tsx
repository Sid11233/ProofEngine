"use client";

import { useSyncExternalStore } from "react";
import { Illustration } from "@/components/illustrations/illustration";
import { Icon } from "@/components/ui/icons";

const KEY = "pe-tip-reminders-dismissed";
const subscribe = (notify: () => void) => { window.addEventListener("storage", notify); return () => window.removeEventListener("storage", notify); };
const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

/** A dismissible tip about reminders. Remembered in this browser. */
export function ReminderTip() {
  const dismissed = useSyncExternalStore(subscribe, read, () => true);
  if (dismissed) return null;
  return (
    <aside aria-label="Tip" className="relative flex items-center gap-5 rounded-card border border-[#fbd9c8] bg-tint p-4 pr-12">
      <Illustration id="RQ-4" decorative className="w-20 shrink-0" />
      <div>
        <p className="font-semibold">Tip</p>
        <p className="text-sm text-neutral-700">Clients reply faster to a reminder after 3 days.</p>
      </div>
      <button
        type="button"
        aria-label="Dismiss tip"
        className="absolute right-2 top-2 inline-flex size-9 items-center justify-center rounded-control text-muted hover:bg-black/[0.05]"
        onClick={() => { try { localStorage.setItem(KEY, "1"); } catch { /* it will simply show again */ } window.dispatchEvent(new Event("storage")); }}
      >
        <Icon name="x" size={16} />
      </button>
    </aside>
  );
}

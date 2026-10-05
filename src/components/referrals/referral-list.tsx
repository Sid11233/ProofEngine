"use client";

import { useState, useTransition } from "react";
import type { ReferralActionResult } from "@/app/app/referrals/actions";

export interface ReferralView {
  id: string;
  name: string;
  contact: string;
  status: string;
  created: string;
}

const STATUSES = ["new", "contacted", "won", "dismissed"] as const;
const select = "min-h-11 rounded-md border border-neutral-300 bg-transparent px-2 text-base disabled:opacity-60 dark:border-neutral-700";

export function ReferralList({ items, canEdit, setStatus }: { items: ReferralView[]; canEdit: boolean; setStatus: (id: string, status: string) => Promise<ReferralActionResult> }) {
  const [message, setMessage] = useState<ReferralActionResult>();
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      <div role="status" aria-live="polite">{message && !message.ok ? <p className="text-sm text-red-700 dark:text-red-400">{message.message}</p> : null}</div>
      <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate font-medium">{item.name}</span>
              <span className="block truncate text-sm text-neutral-600 dark:text-neutral-400">{item.contact} · {item.created}</span>
            </span>
            {canEdit ? (
              <select
                aria-label={`Status for ${item.name}`}
                className={select}
                defaultValue={item.status}
                disabled={pending}
                onChange={(e) => start(async () => setMessage(await setStatus(item.id, e.target.value)))}
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700">{item.status}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

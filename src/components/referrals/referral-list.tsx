"use client";

import { useState, useTransition } from "react";
import type { ReferralActionResult } from "@/app/app/referrals/actions";
import { Avatar } from "@/components/ui/avatar";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";

export interface ReferralView {
  id: string;
  name: string;
  contact: string;
  status: string;
  /** Pre-formatted, such as "Oct 4". */
  created: string;
}

const STATUSES = [["new", "New"], ["contacted", "Contacted"], ["won", "Won"], ["dismissed", "Dismissed"]] as const;

export function ReferralList({ items, canEdit, setStatus }: { items: ReferralView[]; canEdit: boolean; setStatus: (id: string, status: string) => Promise<ReferralActionResult> }) {
  const [message, setMessage] = useState<ReferralActionResult>();
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      <div role="status" aria-live="polite">{message && !message.ok ? <p className="text-sm text-red-700">{message.message}</p> : null}</div>
      <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <Avatar name={item.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{item.name}</span>
              <span className="block truncate text-sm text-muted">{item.contact} · <span className="tnum">{item.created}</span></span>
            </span>
            {canEdit ? (
              <Select aria-label={`Status for ${item.name}`} className="w-40" defaultValue={item.status} disabled={pending} onChange={(e) => start(async () => setMessage(await setStatus(item.id, e.target.value)))}>
                {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            ) : (
              <StatusPill status={item.status} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

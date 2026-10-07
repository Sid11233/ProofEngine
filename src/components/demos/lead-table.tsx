"use client";

import { useState, useTransition } from "react";
import { deleteLeadAction } from "@/app/app/demos/[id]/results/actions";
import { Button } from "@/components/ui/button";

export interface LeadRow { id: string; email: string; name: string | null; created: string; step: number | null }

/** Plain text only. Emails and names are visitor input, shown as text. */
export function LeadTable({ demoId, leads, canDelete }: { demoId: string; leads: LeadRow[]; canDelete: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (leads.length === 0) return <p className="text-sm text-muted">No leads yet.</p>;
  return (
    <div className="space-y-2">
      {message ? <p role="alert" className="text-sm text-[#b42318]">{message}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted"><tr><th className="py-2 pr-4 font-medium">Email</th><th className="py-2 pr-4 font-medium">Name</th><th className="py-2 pr-4 font-medium">Date</th><th className="py-2 pr-4 font-medium">Reached step</th><th /></tr></thead>
          <tbody className="divide-y divide-line">
            {leads.map((l) => (
              <tr key={l.id}>
                <td className="py-2 pr-4 break-all">{l.email}</td>
                <td className="py-2 pr-4">{l.name ?? ""}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{l.created}</td>
                <td className="py-2 pr-4">{l.step === null ? "" : l.step + 1}</td>
                <td className="py-2 text-right">{canDelete ? <Button size="sm" variant="quiet" disabled={pending} aria-label={`Delete lead ${l.email}`} onClick={() => { if (window.confirm("Delete this lead?")) start(async () => { const r = await deleteLeadAction(demoId, l.id); setMessage(r.ok ? null : (r.message ?? "Could not delete.")); }); }}>Delete</Button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

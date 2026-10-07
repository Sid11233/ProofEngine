"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { Icon } from "@/components/ui/icons";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";

export interface RequestRow {
  id: string;
  clientName: string;
  projectType: string | null;
  status: string;
  /** Pre-formatted, such as "Oct 4". */
  date: string;
}

type Filter = "all" | "started" | "completed";
const FILTERS: Array<[Filter, string]> = [["all", "All"], ["started", "Started"], ["completed", "Completed"]];
const PAGE = 20;

/** "Add project type" shown quietly where the type is empty: a small inline field, not text saying it is missing. */
function AddProjectType({ id, canEdit, save }: { id: string; canEdit: boolean; save: (input: unknown) => Promise<{ ok: boolean; message?: string }> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="relative z-10 inline-flex min-h-9 items-center text-sm text-muted underline decoration-dashed underline-offset-4 hover:text-foreground">
        Add project type
      </button>
    );
  }
  return (
    <form
      className="relative z-10 flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await save({ requestId: id, projectType: value });
          if (result.ok) setOpen(false);
          else setMessage(result.message ?? "Could not save.");
        });
      }}
    >
      <label className="sr-only" htmlFor={`pt-${id}`}>Project type</label>
      <input id={`pt-${id}`} autoFocus value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} placeholder="For example: website redesign" className="min-h-9 w-56 max-w-full rounded-control border border-line bg-surface px-3 text-sm" />
      <Button type="submit" size="sm" loading={pending} disabled={value.trim() === ""}>Save</Button>
      <Button type="button" size="sm" variant="quiet" onClick={() => setOpen(false)}>Cancel</Button>
      {message ? <span role="alert" className="text-sm text-red-700">{message}</span> : null}
    </form>
  );
}

/** Filter chips and the rows. The whole row is one link; the inline action sits above it. Long lists load 20 at a time. */
export function RequestList({ rows, canEdit, saveProjectType }: { rows: RequestRow[]; canEdit: boolean; saveProjectType: (input: unknown) => Promise<{ ok: boolean; message?: string }> }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const matching = rows.filter((row) => filter === "all" || row.status === filter);
  const visible = matching.slice(0, shown);

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Filter requests" className="flex flex-wrap gap-2">
        {FILTERS.map(([value, label]) => (
          <Chip key={value} selected={filter === value} onClick={() => { setFilter(value); setShown(PAGE); }}>{label}</Chip>
        ))}
      </div>

      {matching.length === 0 ? (
        <p role="status" className="rounded-card border border-line bg-surface p-5 text-sm text-muted">No {filter === "all" ? "" : `${filter} `}requests to show.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {visible.map((row) => (
            <li key={row.id} className="relative flex items-center gap-4 px-4 py-3 hover:bg-[#fafaf9]">
              <Avatar name={row.clientName} size="md" />
              <div className="min-w-0 flex-1">
                <Link href={`/app/requests/${row.id}`} className="block truncate font-semibold text-foreground no-underline after:absolute after:inset-0 hover:no-underline">{row.clientName}</Link>
                {row.projectType ? <span className="block truncate text-sm text-muted">{row.projectType}</span> : <AddProjectType id={row.id} canEdit={canEdit} save={saveProjectType} />}
              </div>
              <StatusPill status={row.status} />
              <span className="tnum hidden w-14 shrink-0 text-right text-sm text-muted sm:block">{row.date}</span>
              <Icon name="chevronRight" size={16} className="text-[#a8a29e]" />
            </li>
          ))}
        </ul>
      )}

      {matching.length > shown ? (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => setShown(shown + PAGE)}>Show more ({matching.length - shown} left)</Button>
        </div>
      ) : null}
    </div>
  );
}

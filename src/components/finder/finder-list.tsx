"use client";

import { useMemo, useState, useTransition } from "react";
import type { FinderActionResult } from "@/app/app/finder/actions";
import type { CommunityView, TrackerEntry } from "@/lib/finder/load";
import { TRACKER_STATUSES, type TrackerStatus } from "@/lib/finder/schemas";

interface Props {
  communities: CommunityView[];
  tracker: Record<string, TrackerEntry>;
  canTrack: boolean;
  hasNiche: boolean;
  actions: {
    save: (input: unknown) => Promise<FinderActionResult>;
    remove: (input: unknown) => Promise<FinderActionResult>;
  };
}

const field = "block min-h-11 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base dark:border-neutral-700";
const button = "inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-4 text-sm font-medium disabled:opacity-50 dark:border-neutral-700";

/** The user's own words, rendered as a text node only. */
function Card({ c, entry, canTrack, actions }: { c: CommunityView; entry: TrackerEntry | undefined; canTrack: boolean; actions: Props["actions"] }) {
  const [status, setStatus] = useState<TrackerStatus | "none">(entry?.status ?? "none");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [message, setMessage] = useState<FinderActionResult>();
  const [pending, start] = useTransition();
  const dirty = status !== (entry?.status ?? "none") || notes !== (entry?.notes ?? "");

  function save() {
    start(async () => {
      if (status === "none") setMessage(await actions.remove({ communityId: c.id }));
      else setMessage(await actions.save({ communityId: c.id, status, notes }));
    });
  }

  return (
    <li className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800" data-testid="community">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">{c.name}</h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400"><span className="capitalize">{c.platform}</span>{c.audience ? ` · ${c.audience}` : ""}</p>
        </div>
        {c.needsVerification ? (
          <span className="rounded-full border border-amber-700/40 bg-amber-50 px-2 py-0.5 text-xs text-amber-950">Needs verification</span>
        ) : (
          <span className="text-xs text-neutral-600 dark:text-neutral-400">Verified {c.lastVerifiedAt?.slice(0, 10) ?? ""}</span>
        )}
      </div>

      {c.rulesSummary ? <p className="text-sm"><span className="font-medium">Rules: </span>{c.rulesSummary}</p> : null}
      {c.selfPromoPolicy ? <p className="text-sm"><span className="font-medium">Self-promotion: </span>{c.selfPromoPolicy}</p> : null}
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Read this community&rsquo;s rules before you post anything.</p>
      <p><a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm underline underline-offset-2">Open {c.name} (new tab)</a></p>

      {canTrack ? (
        <div className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <label className="block text-sm font-medium" htmlFor={`status-${c.id}`}>Your status</label>
          <select id={`status-${c.id}`} className={field} value={status} onChange={(e) => setStatus(e.target.value as TrackerStatus | "none")}>
            <option value="none">Not tracking</option>
            {TRACKER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {status !== "none" ? (
            <>
              <label className="block text-sm font-medium" htmlFor={`notes-${c.id}`}>Notes (plain text)</label>
              <textarea id={`notes-${c.id}`} className={field} rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={button} disabled={pending || !dirty} onClick={save}>Save</button>
            <span role="status" aria-live="polite" className="text-sm">{message ? (message.ok ? "Saved." : message.message) : null}</span>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function FinderList({ communities, tracker, canTrack, hasNiche, actions }: Props) {
  const [platform, setPlatform] = useState("all");
  const [mine, setMine] = useState(false);
  const platforms = useMemo(() => [...new Set(communities.map((c) => c.platform))].sort(), [communities]);
  const shown = communities.filter((c) => (platform === "all" || c.platform === platform) && (!mine || tracker[c.id]));

  return (
    <div className="space-y-4">
      <p role="note" className="rounded-md border border-amber-700/40 bg-amber-50 p-3 text-sm text-amber-950">
        <strong>Read the rules before you post.</strong> Many communities ban or limit self-promotion. This list is a starting point, it may be out of date, and we do not check what you post. Never post a client&rsquo;s story without their approval.
      </p>
      {!hasNiche ? <p className="text-sm text-neutral-600 dark:text-neutral-400">Add your niche and audience in your workspace settings to rank this list for you.</p> : null}

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label htmlFor="platform-filter" className="block text-sm font-medium">Platform</label>
          <select id="platform-filter" className={`${field} w-auto`} value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="all">All platforms</option>
            {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {canTrack ? (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only the ones I track
          </label>
        ) : null}
      </div>

      {shown.length === 0 ? <p className="text-neutral-600 dark:text-neutral-400">Nothing matches those filters.</p> : null}
      <ul className="space-y-4">
        {shown.map((c) => <Card key={c.id} c={c} entry={tracker[c.id]} canTrack={canTrack} actions={actions} />)}
      </ul>
    </div>
  );
}

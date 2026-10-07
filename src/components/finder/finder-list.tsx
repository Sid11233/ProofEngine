"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import type { FinderActionResult } from "@/app/app/finder/actions";
import { Illustration } from "@/components/illustrations/illustration";
import { Callout } from "@/components/ui/callout";
import { Chip } from "@/components/ui/chip";
import { Icon } from "@/components/ui/icons";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { CommunityView, TrackerEntry } from "@/lib/finder/load";
import type { TrackerStatus } from "@/lib/finder/schemas";

interface Props {
  communities: CommunityView[];
  tracker: Record<string, TrackerEntry>;
  canTrack: boolean;
  hasNiche: boolean;
  /** Platform operators also see communities that have not been verified yet. */
  showUnverified: boolean;
  actions: {
    save: (input: unknown) => Promise<FinderActionResult>;
    remove: (input: unknown) => Promise<FinderActionResult>;
  };
}

type Choice = TrackerStatus | "none";
const OPTIONS: Array<{ value: "none" | "saved" | "joined" | "posted"; label: string }> = [
  { value: "none", label: "Not tracking" },
  { value: "saved", label: "Saved" },
  { value: "joined", label: "Joined" },
  { value: "posted", label: "Posted" },
];

const platformLabel = (p: string) => `${p.charAt(0).toUpperCase()}${p.slice(1)}`;

/** A community. The user's own notes are rendered as text only. */
function CommunityCard({ c, entry, canTrack, actions }: { c: CommunityView; entry: TrackerEntry | undefined; canTrack: boolean; actions: Props["actions"] }) {
  const [status, setStatus] = useState<Choice>(entry?.status ?? "none");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const savedNotes = useRef(entry?.notes ?? "");
  const shownStatus: "none" | "saved" | "joined" | "posted" = status === "dropped" ? "none" : status;

  function persist(next: Choice, nextNotes: string) {
    start(async () => {
      const result = next === "none" ? await actions.remove({ communityId: c.id }) : await actions.save({ communityId: c.id, status: next, notes: nextNotes });
      setSaved(result.ok ? "Saved" : (result.message ?? "Could not save"));
      if (result.ok) savedNotes.current = nextNotes;
    });
  }

  return (
    <li data-testid="community" className="space-y-4 rounded-card border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-tint text-sm font-semibold text-[#b43a0c]">{c.platform.charAt(0).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug">{c.name}</h3>
          <p className="text-sm text-muted"><span>{platformLabel(c.platform)}</span>{c.audience ? ` · ${c.audience}` : ""}</p>
        </div>
        {c.needsVerification ? <span className="shrink-0 rounded-full border border-[#f3e2a9] bg-[#fff8e6] px-2.5 py-1 text-xs font-medium text-[#8a5a00]">Needs verification</span> : null}
      </div>

      <div className="border-y border-line">
        <button type="button" aria-expanded={open} aria-controls={`rules-${c.id}`} onClick={() => setOpen(!open)} className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-medium">
          Rules and self-promotion
          <Icon name="chevronRight" size={16} className={`text-muted transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
        </button>
        <div id={`rules-${c.id}`} role="region" aria-label="Rules and self-promotion" className="grid transition-[grid-template-rows] duration-[260ms]" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
          <div className="overflow-hidden">
            <div className="space-y-2 pb-3 text-sm" hidden={!open}>
              {c.rulesSummary ? <p><span className="font-medium">Rules: </span>{c.rulesSummary}</p> : null}
              {c.selfPromoPolicy ? <p><span className="font-medium">Self-promotion: </span>{c.selfPromoPolicy}</p> : null}
              {!c.rulesSummary && !c.selfPromoPolicy ? <p className="text-muted">We have not summarised this community&rsquo;s rules yet. Read them on the community itself before you post.</p> : null}
            </div>
          </div>
        </div>
      </div>

      {canTrack ? (
        <div className="space-y-3">
          <SegmentedControl label={`Your status for ${c.name}`} options={OPTIONS} value={shownStatus} onChange={(next) => { setStatus(next); persist(next, notes); }} />
          {shownStatus !== "none" ? (
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor={`notes-${c.id}`}>Notes</label>
              <textarea id={`notes-${c.id}`} rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== savedNotes.current) persist(status, notes); }} className="block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm" />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 text-sm">
        <span role="status" aria-live="polite" className="text-muted">{canTrack ? (saved ?? "Saved automatically") : ""}</span>
        <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-foreground">
          Open community <Icon name="external" size={14} /><span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </li>
  );
}

export function FinderList({ communities, tracker, canTrack, hasNiche, showUnverified, actions }: Props) {
  const [platform, setPlatform] = useState("all");
  const [mine, setMine] = useState(false);
  // Communities nobody has verified are hidden from normal users.
  const listed = useMemo(() => communities.filter((c) => showUnverified || !c.needsVerification), [communities, showUnverified]);
  const platforms = useMemo(() => [...new Set(listed.map((c) => c.platform))].sort(), [listed]);
  const shown = listed.filter((c) => (platform === "all" || c.platform === platform) && (!mine || tracker[c.id]));

  return (
    <div className="space-y-5">
      <Callout tone="warn" icon="shield">
        <strong>Read the rules before you post.</strong> Many communities limit self-promotion. Never post a client&rsquo;s story without their approval.
      </Callout>
      {!hasNiche ? <p className="text-sm text-muted">Add your niche and audience in your workspace settings to rank this list for you.</p> : null}

      {listed.length > 0 ? (
        <div role="group" aria-label="Filter communities" className="flex flex-wrap gap-2">
          <Chip selected={platform === "all"} onClick={() => setPlatform("all")}>All platforms</Chip>
          {platforms.map((p) => <Chip key={p} selected={platform === p} onClick={() => setPlatform(p)}>{platformLabel(p)}</Chip>)}
          {canTrack ? <Chip selected={mine} onClick={() => setMine(!mine)}>Tracked only</Chip> : null}
        </div>
      ) : null}

      {listed.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-card border border-line bg-surface px-6 py-10 text-center">
          <Illustration id="FD-1" decorative className="w-56" />
          <div>
            <h2 className="text-lg font-semibold">No communities to show yet</h2>
            <p className="mt-1 text-sm text-muted">We only list a community after checking its rules. Check back soon.</p>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-card border border-line bg-surface px-6 py-10 text-center">
          <Illustration id="FD-2" decorative className="w-56" />
          <div>
            <h2 className="text-lg font-semibold">{mine ? "You are not tracking any communities yet" : "Nothing matches those filters"}</h2>
            <p className="mt-1 text-sm text-muted">{mine ? "Mark a community as Saved, Joined or Posted and it appears here." : "Try another platform."}</p>
          </div>
        </div>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {shown.map((c) => <CommunityCard key={c.id} c={c} entry={tracker[c.id]} canTrack={canTrack} actions={actions} />)}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import type { SelectTemplateResult } from "@/app/app/case-studies/[id]/template/actions";

export interface GalleryItem {
  id: string;
  name: string;
  category: string;
  tier: string;
  allowed: boolean;
  selected: boolean;
  /** The owner's own content, rendered in this template (server-rendered, passed as a node). */
  thumbnail: React.ReactNode;
}

const TIER_LABEL: Record<string, string> = { free: "Free", pro: "Pro", pack: "Template pack" };

export function TemplateGallery({
  studyId,
  items,
  canEdit,
  select,
}: {
  studyId: string;
  items: GalleryItem[];
  canEdit: boolean;
  select: (studyId: string, templateId: string) => Promise<SelectTemplateResult>;
}) {
  const categories = useMemo(() => ["all", ...new Set(items.map((i) => i.category))], [items]);
  const [category, setCategory] = useState("all");
  const [selectedId, setSelectedId] = useState(items.find((i) => i.selected)?.id);
  const [message, setMessage] = useState<SelectTemplateResult>();
  const [pending, startTransition] = useTransition();
  const visible = items.filter((i) => category === "all" || i.category === category);

  function choose(templateId: string) {
    setMessage(undefined);
    startTransition(async () => {
      const result = await select(studyId, templateId);
      setMessage(result);
      if (result.ok) setSelectedId(templateId);
    });
  }

  return (
    <div className="space-y-5">
      <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
            className="min-h-11 rounded-full border border-neutral-300 px-4 text-sm capitalize outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 aria-pressed:bg-neutral-900 aria-pressed:text-white dark:border-neutral-700 dark:aria-pressed:bg-neutral-100 dark:aria-pressed:text-neutral-900"
          >
            {c}
          </button>
        ))}
      </div>

      <div aria-live="polite" role="status">
        {message?.message ? (
          <p className={message.ok ? "rounded-md border border-green-700/30 bg-green-50 px-3 py-2 text-sm text-green-900 dark:bg-green-950 dark:text-green-100" : "rounded-md border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"}>{message.message}</p>
        ) : null}
      </div>

      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((item) => (
          <li key={item.id} className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="relative h-72 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800" aria-hidden="true">
              {/* A 1024px wide render scaled down to a thumbnail; not interactive. */}
              <div className="pointer-events-none absolute left-0 top-0 w-[1024px] origin-top-left scale-[0.28]">{item.thumbnail}</div>
            </div>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">{item.name}</h2>
                <p className="text-sm capitalize text-neutral-600 dark:text-neutral-400">{item.category}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${item.allowed ? "bg-neutral-100 dark:bg-neutral-800" : "bg-amber-100 text-amber-950 dark:bg-amber-900 dark:text-amber-100"}`}
              >
                {item.allowed ? TIER_LABEL[item.tier] ?? item.tier : `Locked: ${TIER_LABEL[item.tier] ?? item.tier}`}
              </span>
            </div>
            {!item.allowed && (
              <p className="text-sm text-neutral-600 dark:text-neutral-400">You can preview this with a watermark. Publishing needs a plan that includes it.</p>
            )}
            {canEdit ? (
              <button
                type="button"
                disabled={pending || selectedId === item.id}
                onClick={() => choose(item.id)}
                className="min-h-11 rounded-md border border-neutral-300 px-4 text-sm font-medium outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-900 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                {selectedId === item.id ? "Selected" : item.allowed ? "Use this template" : "Preview this template"}
              </button>
            ) : (
              selectedId === item.id && <p className="text-sm font-medium">Selected</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

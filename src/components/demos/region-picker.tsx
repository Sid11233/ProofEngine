"use client";

import { useRef, useState } from "react";
import type { Rect } from "@/lib/demos/schema";

const MIN = 0.01;
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const fmt = (n: number) => Math.round(n * 1000) / 10;

/**
 * Draw boxes on an image by dragging. Boxes are fractions of the image, so they survive any display size.
 * `single` keeps one box (a hotspot); otherwise boxes accumulate up to `max` (areas to blur).
 * The percent fields below the picture do the same thing without a pointer.
 */
export function RegionPicker({ src, value, onChange, single = false, max = 20, label }: { src: string; value: Rect[]; onChange: (next: Rect[]) => void; single?: boolean; max?: number; label: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);

  const point = (e: React.PointerEvent) => {
    const box = frame.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - box.left) / box.width), y: clamp((e.clientY - box.top) / box.height) };
  };
  const rectOf = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  const add = (r: Rect) => onChange(single ? [r] : [...value, r].slice(0, max));
  const style = (r: Rect) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });

  return (
    <div className="space-y-2">
      <div
        ref={frame}
        role="img"
        aria-label={label}
        className="relative touch-none select-none overflow-hidden rounded-lg border border-line"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start.current = point(e); setDraft(null); }}
        onPointerMove={(e) => { if (start.current) setDraft(rectOf(start.current, point(e))); }}
        onPointerUp={() => { if (draft && draft.w >= MIN && draft.h >= MIN) add(draft); start.current = null; setDraft(null); }}
        onPointerCancel={() => { start.current = null; setDraft(null); }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" draggable={false} className="block h-auto w-full" />
        {value.map((r, i) => <span key={i} className="pointer-events-none absolute border-2 border-signal bg-signal/20" style={style(r)} />)}
        {draft ? <span className="pointer-events-none absolute border-2 border-dashed border-signal" style={style(draft)} /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>{value.length ? `${value.length} box${value.length === 1 ? "" : "es"}` : "Drag on the picture to draw a box."}</span>
        {value.length ? <button type="button" className="underline-offset-2 hover:underline" onClick={() => onChange(single ? [] : value.slice(0, -1))}>{single ? "Clear" : "Undo last"}</button> : null}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Set the box with numbers</summary>
        {(single ? value.slice(0, 1) : value).map((r, i) => (
          <div key={i} className="mt-2 grid grid-cols-4 gap-2">
            {(["x", "y", "w", "h"] as const).map((k) => (
              <label key={k} className="block">
                <span className="sr-only">{`Box ${i + 1} ${k}`}</span>
                <input
                  type="number" min={0} max={100} step={0.5} value={fmt(r[k])} aria-label={`Box ${i + 1} ${{ x: "left", y: "top", w: "width", h: "height" }[k]} in percent`}
                  className="block min-h-9 w-full rounded-control border border-line px-2 text-sm"
                  onChange={(e) => { const next = value.map((v, j) => (j === i ? { ...v, [k]: clamp(Number(e.target.value) / 100) } : v)); onChange(next); }}
                />
              </label>
            ))}
          </div>
        ))}
        {single && value.length === 0 ? <button type="button" className="mt-2 underline" onClick={() => onChange([{ x: 0.4, y: 0.4, w: 0.2, h: 0.1 }])}>Add a box</button> : null}
      </details>
    </div>
  );
}

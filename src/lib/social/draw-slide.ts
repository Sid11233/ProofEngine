import type { Slide } from "./carousel";

// Draws one carousel slide on a 2D canvas context. Everything is drawn with fillText, so the slide text can only ever be
// pixels: no markup, no links, nothing executable. The functions take the context as an argument so they can be tested.

export interface SlideTheme {
  id: string;
  label: string;
  bg: string;
  fg: string;
  accent: string;
  muted: string;
}

export const THEMES: readonly SlideTheme[] = [
  { id: "ink", label: "Dark", bg: "#1c1917", fg: "#fafaf9", accent: "#ff7a45", muted: "#a8a29e" },
  { id: "cream", label: "Cream", bg: "#fafaf9", fg: "#1c1917", accent: "#c2410c", muted: "#57534e" },
  { id: "orange", label: "Orange", bg: "#ff5a1f", fg: "#ffffff", accent: "#1c1917", muted: "#fff1eb" },
  { id: "blue", label: "Blue", bg: "#1e3a8a", fg: "#ffffff", accent: "#fcd34d", muted: "#bfdbfe" },
];

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** Breaks text into lines no wider than `maxWidth`. A single word wider than the line is split by characters. */
export function wrapLines(measure: (text: string) => number, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) { line = candidate; continue; }
      if (line) lines.push(line);
      if (measure(word) <= maxWidth) { line = word; continue; }
      let chunk = "";
      for (const ch of word) {
        if (measure(chunk + ch) > maxWidth && chunk) { lines.push(chunk); chunk = ch; } else chunk += ch;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

export interface SlideMeta {
  index: number;
  total: number;
  brand: string;
  /** Added by code for a quote slide; never chosen by the model. */
  attribution?: string;
}

interface Block { text: string; size: number; weight: number; color: string; italic?: boolean; gap: number }

function blocksFor(slide: Slide, meta: SlideMeta, theme: SlideTheme, scale: number): Block[] {
  const b = (text: string, size: number, weight: number, color: string, gap: number, italic = false): Block => ({ text, size: size * scale, weight, color, gap: gap * scale, italic });
  switch (slide.kind) {
    case "stat": return [b(slide.heading, 200, 800, theme.accent, 24), b(slide.body, 54, 500, theme.fg, 0)];
    case "quote": return [b("“", 220, 800, theme.accent, -40), b(slide.body.replace(/^["“]+|["”]+$/g, ""), 58, 500, theme.fg, 40, true), ...(meta.attribution ? [b(`— ${meta.attribution}`, 38, 600, theme.muted, 0)] : [])];
    case "title": return [b(slide.heading, 92, 800, theme.fg, 36), b(slide.body, 46, 500, theme.muted, 0)];
    case "cta": return [b(slide.heading, 80, 800, theme.accent, 32), b(slide.body, 48, 500, theme.fg, 0)];
    default: return [b(slide.heading, 66, 700, theme.accent, 30), b(slide.body, 48, 500, theme.fg, 0)];
  }
}

export function drawSlide(ctx: CanvasRenderingContext2D, size: { width: number; height: number }, slide: Slide, meta: SlideMeta, theme: SlideTheme): void {
  const { width, height } = size;
  const scale = Math.min(width, height) / 1080;
  const pad = 90 * scale;
  const maxWidth = width - pad * 2;

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // Header: brand on the left, position on the right.
  ctx.fillStyle = theme.muted;
  ctx.font = `600 ${32 * scale}px ${FONT}`;
  ctx.fillText(meta.brand.slice(0, 40), pad, pad * 0.7);
  ctx.textAlign = "right";
  ctx.fillText(`${meta.index + 1} / ${meta.total}`, width - pad, pad * 0.7);
  ctx.textAlign = "left";

  // Body blocks, centred vertically.
  const laid = blocksFor(slide, meta, theme, scale)
    .filter((blk) => blk.text.trim() !== "")
    .map((blk) => {
      ctx.font = `${blk.italic ? "italic " : ""}${blk.weight} ${blk.size}px ${FONT}`;
      const lines = wrapLines((t) => ctx.measureText(t).width, blk.text, maxWidth);
      return { blk, lines, lineHeight: blk.size * 1.22 };
    });
  const total = laid.reduce((h, l) => h + l.lines.length * l.lineHeight + l.blk.gap, 0);
  let y = Math.max(pad * 1.4, (height - total) / 2);
  for (const { blk, lines, lineHeight } of laid) {
    ctx.font = `${blk.italic ? "italic " : ""}${blk.weight} ${blk.size}px ${FONT}`;
    ctx.fillStyle = blk.color;
    for (const line of lines) { ctx.fillText(line, pad, y); y += lineHeight; }
    y += blk.gap;
  }

  // Footer cue.
  ctx.fillStyle = theme.muted;
  ctx.font = `600 ${30 * scale}px ${FONT}`;
  if (meta.index < meta.total - 1) {
    ctx.textAlign = "right";
    ctx.fillText("Swipe →", width - pad, height - pad);
  }
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CAROUSEL_HOWTO, SLIDE_SIZE, type Slide } from "@/lib/social/carousel";
import { drawSlide, THEMES, type SlideTheme } from "@/lib/social/draw-slide";
import type { Network } from "@/lib/social/networks";

export interface QuoteSource { body: string; author: string | null }

/** The attribution for a quote slide comes from the typed feedback entry the quote was copied from, never from the model. */
function attributionFor(slide: Slide, sources: QuoteSource[]): string | undefined {
  if (slide.kind !== "quote") return undefined;
  const quote = slide.body.replace(/^["“]+|["”]+$/g, "").trim().toLowerCase();
  const found = sources.find((s) => s.body.toLowerCase().replace(/\s+/g, " ").includes(quote.replace(/\s+/g, " ")));
  return found?.author?.trim() || "A client";
}

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));

/** Draws every slide to a canvas in the network's size, and exports PNGs or a PDF. Runs entirely in the browser. */
export function CarouselPreview({ network, slides, brand, quoteSources, fileName }: { network: Network; slides: Slide[]; brand: string; quoteSources: QuoteSource[]; fileName: string }) {
  const [themeId, setThemeId] = useState(THEMES[0].id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvases = useRef<Array<HTMLCanvasElement | null>>([]);
  const size = SLIDE_SIZE[network];
  const theme: SlideTheme = THEMES.find((t) => t.id === themeId) ?? THEMES[0];

  useEffect(() => {
    let cancelled = false;
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (cancelled) return;
      slides.forEach((slide, i) => {
        const ctx = canvases.current[i]?.getContext("2d");
        if (ctx) drawSlide(ctx, size, slide, { index: i, total: slides.length, brand, attribution: attributionFor(slide, quoteSources) }, theme);
      });
    });
    return () => { cancelled = true; };
  }, [slides, size, brand, quoteSources, theme]);

  async function pngs(): Promise<Blob[]> {
    const out: Blob[] = [];
    for (const c of canvases.current.slice(0, slides.length)) {
      const blob = c ? await toBlob(c) : null;
      if (!blob) throw new Error("render");
      out.push(blob);
    }
    return out;
  }

  async function run(kind: string, task: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try { await task(); } catch { setError("Your browser could not make the file. Try another browser."); } finally { setBusy(null); }
  }

  const downloadAllPngs = () => run("png", async () => {
    const blobs = await pngs();
    for (let i = 0; i < blobs.length; i++) { download(blobs[i], `${fileName}-${i + 1}.png`); await new Promise((r) => setTimeout(r, 250)); }
  });

  const downloadPdf = () => run("pdf", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    for (const blob of await pngs()) {
      const image = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
      const page = doc.addPage([size.width, size.height]);
      page.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
    }
    download(new Blob([new Uint8Array(await doc.save())], { type: "application/pdf" }), `${fileName}.pdf`);
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Slide colours">
        {THEMES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={t.id === themeId} onClick={() => setThemeId(t.id)}
            className={`inline-flex min-h-9 items-center gap-2 rounded-control border px-3 text-sm ${t.id === themeId ? "border-foreground" : "border-line"}`}>
            <span aria-hidden="true" className="size-4 rounded-full border border-line" style={{ background: t.bg }} />{t.label}
          </button>
        ))}
      </div>
      <ol className="flex gap-3 overflow-x-auto pb-2" aria-label="Slides">
        {slides.map((slide, i) => (
          <li key={i} className="shrink-0" style={{ width: Math.round((size.width / size.height) * 280) }}>
            <canvas ref={(el) => { canvases.current[i] = el; }} width={size.width} height={size.height} role="img" aria-label={`Slide ${i + 1}: ${slide.heading || slide.body}`.slice(0, 160)} className="block h-[280px] w-full rounded-lg border border-line" />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {network === "linkedin" ? <Button size="sm" loading={busy === "pdf"} onClick={downloadPdf}>Download PDF</Button> : null}
        <Button size="sm" variant={network === "linkedin" ? "secondary" : "primary"} loading={busy === "png"} onClick={downloadAllPngs}>Download pictures</Button>
        {network !== "linkedin" ? <Button size="sm" variant="secondary" loading={busy === "pdf"} onClick={downloadPdf}>Download PDF</Button> : null}
      </div>
      <p className="text-xs text-muted">{CAROUSEL_HOWTO[network]} Size {size.width} x {size.height}.</p>
      {error ? <p role="alert" className="text-sm text-[#b42318]">{error}</p> : null}
    </div>
  );
}

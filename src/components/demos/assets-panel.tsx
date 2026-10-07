"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import type { Rect } from "@/lib/demos/schema";
import { RegionPicker } from "./region-picker";

export interface AssetView { id: string; width: number; height: number; flagged: boolean }

export const assetSrc = (id: string) => `/api/demo-asset/${id}`;

/** Upload images, and confirm or blur each one. A demo cannot be published while any image still needs confirming. */
export function AssetsPanel({ demoId, assets, locked, onChanged }: { demoId: string; assets: AssetView[]; locked: boolean; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [blurring, setBlurring] = useState<string | null>(null);
  const [regions, setRegions] = useState<Rect[]>([]);
  const base = `/api/demos/${demoId}/assets`;

  async function call(key: string, run: () => Promise<Response>) {
    setBusy(key);
    setMessage(null);
    try {
      const res = await run();
      if (!res.ok) setMessage(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? "That did not work. Please try again.");
      else onChanged();
      return res.ok;
    } catch {
      setMessage("That did not work. Please try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const upload = (file: File) => {
    const form = new FormData();
    form.set("file", file);
    form.set("kind", "screenshot");
    return call("upload", () => fetch(base, { method: "POST", body: form }));
  };
  const patch = (id: string, body: unknown) => call(id, () => fetch(`${base}/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  return (
    <div className="space-y-3">
      {message ? <Callout tone="warn">{message}</Callout> : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {assets.map((a, i) => (
          <li key={a.id} className="space-y-2 rounded-card border border-line p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {blurring === a.id ? null : <img src={assetSrc(a.id)} alt={`Image ${i + 1}`} className="h-32 w-full rounded-lg border border-line object-cover object-top" />}
            <p className="text-sm font-medium">Image {i + 1} {a.flagged ? <span className="text-[#8a5a00]">· needs confirming</span> : <span className="text-muted">· confirmed</span>}</p>
            {blurring === a.id ? (
              <div className="space-y-2">
                <RegionPicker src={assetSrc(a.id)} value={regions} onChange={setRegions} label={`Draw boxes over anything private in image ${i + 1}`} />
                <div className="flex gap-2">
                  <Button size="sm" disabled={regions.length === 0} loading={busy === a.id} onClick={async () => { if (await patch(a.id, { how: "blurred", regions })) { setBlurring(null); setRegions([]); } }}>Blur these areas</Button>
                  <Button size="sm" variant="quiet" onClick={() => { setBlurring(null); setRegions([]); }}>Cancel</Button>
                </div>
              </div>
            ) : !locked ? (
              <div className="flex flex-wrap gap-2">
                {a.flagged ? <Button size="sm" variant="secondary" loading={busy === a.id} onClick={() => patch(a.id, { how: "acknowledged" })}>Nothing private here</Button> : null}
                <Button size="sm" variant="secondary" onClick={() => { setBlurring(a.id); setRegions([]); }}>Blur areas</Button>
                <Button size="sm" variant="quiet" loading={busy === `del-${a.id}`} onClick={() => { if (window.confirm("Remove this image?")) void call(`del-${a.id}`, () => fetch(`${base}/${a.id}`, { method: "DELETE" })); }}>Remove</Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {!locked ? (
        <>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Upload an image" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) await upload(f); }} />
          <Button variant="secondary" loading={busy === "upload"} disabled={assets.length >= 40} onClick={() => input.current?.click()}>Upload an image</Button>
          <p className="text-xs text-muted">PNG, JPG or WebP, up to 5 MB, up to 40 images. Check every picture for names, emails, keys and other private details. Blurring changes the stored file itself.</p>
        </>
      ) : <p className="text-xs text-muted">Unpublish the demo to change its images.</p>}
    </div>
  );
}

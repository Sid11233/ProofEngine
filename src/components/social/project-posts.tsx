"use client";

import { useState, useTransition } from "react";
import type { PostsResult } from "@/app/app/projects/[id]/posts/actions";
import { CopyButton } from "@/components/motion/copy-button";
import { useToast } from "@/components/motion/toast";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { TextArea, TextInput } from "@/components/ui/fields";
import { MAX_HEADING, MAX_SLIDE_BODY, type Slide } from "@/lib/social/carousel";
import { NETWORK_INFO, NETWORKS, type Network } from "@/lib/social/networks";
import { CarouselPreview, type QuoteSource } from "./carousel-preview";

export interface PostView {
  id: string;
  network: Network;
  kind: "post" | "carousel";
  body: string;
  slides: Slide[] | null;
  status: "draft" | "saved" | "posted";
  openHref: string;
}

interface Actions {
  generate: (input: unknown) => Promise<PostsResult>;
  edit: (postId: string, input: unknown) => Promise<PostsResult>;
  discard: (postId: string) => Promise<PostsResult>;
}

/** Generate form: networks and the attestation that the client agreed to be quoted and shown. */
export function GenerateForm({ canEdit, hasFacts, actions }: { canEdit: boolean; hasFacts: boolean; actions: Pick<Actions, "generate"> }) {
  const [networks, setNetworks] = useState<Network[]>(["linkedin", "instagram"]);
  const [attested, setAttested] = useState(false);
  const [message, setMessage] = useState<PostsResult>();
  const [pending, start] = useTransition();
  if (!canEdit) return <p className="text-sm text-muted">You can view posts but not create them.</p>;
  const toggle = (n: Network) => setNetworks((l) => (l.includes(n) ? l.filter((x) => x !== n) : [...l, n]));

  return (
    <div className="space-y-4">
      {!hasFacts ? <Callout tone="warn">Add a summary, key facts or client feedback to the project first. Posts can only use what is written there.</Callout> : null}
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Networks</legend>
        <div className="flex flex-wrap gap-x-5">
          {NETWORKS.map((n) => <Checkbox key={n} checked={networks.includes(n)} onChange={() => toggle(n)}>{NETWORK_INFO[n].label}</Checkbox>)}
        </div>
      </fieldset>
      <Checkbox checked={attested} onChange={(e) => setAttested(e.target.checked)}>I have the client&apos;s permission to share this project and to quote their feedback in public posts.</Checkbox>
      <div className="flex flex-wrap items-center gap-3">
        <Button loading={pending} disabled={!hasFacts || !attested || networks.length === 0} onClick={() => start(async () => setMessage(await actions.generate({ networks, attested: true })))}>Write posts and carousels</Button>
        <p role="status" aria-live="polite" className={`text-sm ${message?.ok ? "text-[#166534]" : "text-[#b42318]"}`}>{message?.message ?? ""}</p>
      </div>
      <p className="text-xs text-muted">The AI only sees the summary, key facts and feedback you wrote here. Numbers must be written in them, and quotes are copied word for word from client feedback. Anything else is dropped.</p>
    </div>
  );
}

export function PostCard({ post, canEdit, brand, quoteSources, projectSlug, actions }: { post: PostView; canEdit: boolean; brand: string; quoteSources: QuoteSource[]; projectSlug: string; actions: Pick<Actions, "edit" | "discard"> }) {
  const toast = useToast();
  const [body, setBody] = useState(post.body);
  const [slides, setSlides] = useState<Slide[]>(post.slides ?? []);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const info = NETWORK_INFO[post.network];
  const dirty = body !== post.body || JSON.stringify(slides) !== JSON.stringify(post.slides ?? []);

  const run = (fn: () => Promise<PostsResult>, ok?: string) => start(async () => {
    const r = await fn();
    setError(r.ok ? undefined : r.message);
    if (r.ok && ok) toast.show(ok, "success");
  });
  const setSlide = (i: number, patch: Partial<Slide>) => setSlides((l) => l.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-semibold">{info.label} · {post.kind === "carousel" ? "Carousel" : "Post"}</h3>
        <span className="text-xs text-muted">{post.status === "draft" ? "Draft" : post.status === "saved" ? "Saved" : "Posted"}</span>
      </div>
      {post.kind === "carousel" && slides.length > 0 ? <CarouselPreview network={post.network} slides={slides} brand={brand} quoteSources={quoteSources} fileName={`${projectSlug}-${post.network}`} /> : null}
      <label className="block space-y-1">
        <span className="text-sm font-medium">{post.kind === "carousel" ? "Caption" : "Text"}</span>
        <TextArea rows={post.kind === "carousel" ? 4 : 6} maxLength={info.maxChars} value={body} disabled={!canEdit} onChange={(e) => setBody(e.target.value)} />
        <span className="block text-xs text-muted">{body.length} / {info.maxChars}</span>
      </label>
      {post.kind === "carousel" && canEdit ? (
        <details className="rounded-control border border-line px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Edit the slides</summary>
          <ol className="mt-3 space-y-3">
            {slides.map((s, i) => (
              <li key={i} className="grid gap-2">
                <span className="text-xs text-muted">Slide {i + 1} ({s.kind})</span>
                <TextInput aria-label={`Slide ${i + 1} heading`} maxLength={MAX_HEADING} value={s.heading} onChange={(e) => setSlide(i, { heading: e.target.value })} />
                <TextArea aria-label={`Slide ${i + 1} text`} rows={2} maxLength={MAX_SLIDE_BODY} value={s.body} onChange={(e) => setSlide(i, { body: e.target.value })} />
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {error ? <p role="alert" className="text-sm text-[#b42318]">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={body} label="Copy text" onError={(m) => toast.show(m, "error")} />
        <a href={post.openHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-md border border-neutral-400 px-4 text-sm font-medium no-underline">Open {info.label}</a>
        {canEdit && dirty ? <Button size="sm" loading={pending} onClick={() => run(() => actions.edit(post.id, { body, ...(post.kind === "carousel" ? { slides } : {}) }), "Saved")}>Save changes</Button> : null}
        {canEdit && post.status === "draft" ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => actions.edit(post.id, { status: "saved" }))}>Keep this one</Button> : null}
        {canEdit && post.status !== "posted" ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => actions.edit(post.id, { status: "posted" }))}>Mark as posted</Button> : null}
        {canEdit && post.status !== "draft" ? <Button size="sm" variant="quiet" disabled={pending} onClick={() => run(() => actions.edit(post.id, { status: "draft" }))}>Undo</Button> : null}
        {canEdit ? <Button size="sm" variant="quiet" disabled={pending} onClick={() => { if (window.confirm("Discard this one?")) run(() => actions.discard(post.id)); }}>Discard</Button> : null}
      </div>
    </Card>
  );
}

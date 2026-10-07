"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AutosaveResult, LifecycleResult, PreviewActionResult } from "@/app/app/case-studies/[id]/edit/actions";
import { numbersMatch, quoteMatches } from "@/lib/case-study/claim-check";
import { slugify } from "@/lib/case-study/slug";
import { caseStudyContentSchema, type CaseStudyContent, type Section } from "@/lib/case-study/schema";
import { FONT_PAIR_LABELS, FONT_PAIRS, MODES, RADII, SPACINGS, themeSchema, type Theme } from "@/lib/case-study/theme";
import type { Blocker } from "@/lib/case-study/publish-check";
import type { Template } from "@/lib/templates/model";
import { Flag, Source, type ReviewClaim } from "./claim-parts";
import { RefineControl, RefinedBadge, type RefineActions } from "./refine-control";
import { CopyButton } from "@/components/motion/copy-button";
import { LoadingButton, type ButtonPhase } from "@/components/motion/loading-button";
import { CaseStudyView } from "./view/case-study-view";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";

interface Props {
  id: string;
  version: number;
  status: string;
  canEdit: boolean;
  initialContent: CaseStudyContent;
  initialTheme: Theme;
  template: Template;
  templateLocked: boolean;
  claims: ReviewClaim[];
  logoUrl: string | null;
  previews: Array<{ id: string; expires: string }>;
  blockers: Blocker[];
  role: string;
  slug: string | null;
  declined: boolean;
  /** What the client last asked to change, shown as plain text. */
  clientNote: string | null;
  /** Field paths rewritten with AI, from the database. */
  refinedFields: string[];
  refine: RefineActions;
  actions: {
    autosave: (id: string, content: unknown) => Promise<AutosaveResult>;
    saveTheme: (id: string, theme: unknown) => Promise<AutosaveResult>;
    createPreview: (id: string) => Promise<PreviewActionResult>;
    revokePreview: (id: string, previewId: string) => Promise<PreviewActionResult>;
    requestApproval: (id: string) => Promise<LifecycleResult>;
    publish: (id: string, slug: string | null, headline: string) => Promise<LifecycleResult>;
    unpublish: (id: string) => Promise<LifecycleResult>;
  };
}

const DEVICES = { desktop: { label: "Desktop", width: "100%" }, tablet: { label: "Tablet", width: "768px" }, mobile: { label: "Mobile", width: "390px" } } as const;
type Device = keyof typeof DEVICES;
const AUTOSAVE_MS = 5000;
const DRAG_TYPE = "text/plain";
const LOCKED_WATERMARK = "Preview only: needs an upgrade to publish";
// Section types that are plain text, so owners can add them without inventing a number or quote.
const ADDABLE = ["challenge", "trigger", "solution", "audience", "cta"] as const;

const field =
  "block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base outline-none focus-visible:border-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/20 disabled:opacity-70 dark:border-neutral-700 dark:focus-visible:border-neutral-100";
const smallButton =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-neutral-300 px-3 text-sm outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900";

let counter = 0;
const nextId = () => `s${++counter}`;

export function CaseStudyEditor(props: Props) {
  const { id, status, canEdit, template, templateLocked, claims, blockers, actions } = props;
  const [content, setContent] = useState(props.initialContent);
  const [sectionIds, setSectionIds] = useState(() => props.initialContent.sections.map(nextId));
  const [theme, setTheme] = useState(props.initialTheme);
  const [logoUrl, setLogoUrl] = useState(props.logoUrl);
  const [device, setDevice] = useState<Device>("desktop");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [version, setVersion] = useState(props.version);
  const [save, setSave] = useState<{ state: "saved" | "saving" | "unsaved" | "error"; at?: string; message?: string }>({ state: "saved" });
  const [, setDragFrom] = useState<number | null>(null);
  const [logoMessage, setLogoMessage] = useState<string>();
  const [refined, setRefined] = useState(() => new Set(props.refinedFields));
  const claimOf = useMemo(() => new Map(claims.map((c) => [c.id, c] as const)), [claims]);

  const validation = useMemo(() => caseStudyContentSchema.safeParse(content), [content]);
  const themeValidation = useMemo(() => themeSchema.safeParse(theme), [theme]);

  // Refs let the 5 second timer see the latest values without restarting.
  const latest = useRef({ content, theme, valid: validation.success, themeValid: themeValidation.success });
  useEffect(() => {
    latest.current = { content, theme, valid: validation.success, themeValid: themeValidation.success };
  });
  // The last saved JSON lives in a ref (for the timer) and in state (so "unsaved" can be shown while rendering).
  const savedContent = useRef(JSON.stringify(props.initialContent));
  const savedTheme = useRef(JSON.stringify(props.initialTheme));
  const [savedJson, setSavedJson] = useState(() => ({ content: JSON.stringify(props.initialContent), theme: JSON.stringify(props.initialTheme) }));
  const busy = useRef(false);

  const flush = useCallback(async () => {
    if (!canEdit || busy.current) return;
    const { content: c, theme: t, valid, themeValid } = latest.current;
    const contentJson = JSON.stringify(c);
    const themeJson = JSON.stringify(t);
    const contentDirty = contentJson !== savedContent.current && valid;
    const themeDirty = themeJson !== savedTheme.current && themeValid;
    if (!contentDirty && !themeDirty) return;

    busy.current = true;
    setSave((s) => ({ ...s, state: "saving" }));
    try {
      if (contentDirty) {
        const result = await actions.autosave(id, c);
        if (!result.ok) return setSave({ state: "error", message: result.message });
        savedContent.current = contentJson;
        setSavedJson((s) => ({ ...s, content: contentJson }));
        if (result.version) setVersion(result.version);
      }
      if (themeDirty) {
        const result = await actions.saveTheme(id, t);
        if (!result.ok) return setSave({ state: "error", message: result.message });
        savedTheme.current = themeJson;
        setSavedJson((s) => ({ ...s, theme: themeJson }));
      }
      setSave({ state: "saved", at: new Date().toLocaleTimeString() });
    } catch {
      setSave({ state: "error", message: "We could not save. We will try again." });
    } finally {
      busy.current = false;
    }
  }, [actions, canEdit, id]);

  /** Saves pending edits and says whether the server now has exactly what is on screen. */
  const ensureSaved = useCallback(async () => {
    await flush();
    return JSON.stringify(latest.current.content) === savedContent.current;
  }, [flush]);

  /** The server changed one field (accepted or restored). Mirror it here without marking the page as unsaved. */
  const applyServerText = useCallback((fieldPath: string, text: string, newVersion: number, restored: boolean) => {
    const base = latest.current.content;
    const next = fieldPath === "headline"
      ? { ...base, headline: text }
      : { ...base, sections: base.sections.map((s, i) => (`sections.${i}.body` === fieldPath ? { ...s, body: text } : s)) };
    const json = JSON.stringify(next);
    savedContent.current = json;
    latest.current = { ...latest.current, content: next };
    setContent(next);
    setSavedJson((s) => ({ ...s, content: json }));
    setVersion(newVersion);
    setRefined((set) => { const copy = new Set(set); if (restored) copy.delete(fieldPath); else copy.add(fieldPath); return copy; });
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void flush(), AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, [flush]);

  const unsaved = JSON.stringify(content) !== savedJson.content || JSON.stringify(theme) !== savedJson.theme;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const edit = (next: CaseStudyContent) => {
    setContent(next);
    setSave((s) => ({ ...s, state: "unsaved" }));
  };
  const patchSection = (index: number, patch: Partial<Section>) => edit({ ...content, sections: content.sections.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  const patchTheme = (patch: Partial<Theme>) => {
    setTheme({ ...theme, ...patch });
    setSave((s) => ({ ...s, state: "unsaved" }));
  };

  function move(from: number, to: number) {
    if (to < 0 || to >= content.sections.length || from === to) return;
    const sections = [...content.sections];
    const ids = [...sectionIds];
    sections.splice(to, 0, ...sections.splice(from, 1));
    ids.splice(to, 0, ...ids.splice(from, 1));
    setSectionIds(ids);
    edit({ ...content, sections });
  }

  function addSection(type: (typeof ADDABLE)[number]) {
    const title = type.charAt(0).toUpperCase() + type.slice(1);
    setSectionIds([...sectionIds, nextId()]);
    edit({ ...content, sections: [...content.sections, { type, title, body: "" }] });
  }

  function removeSection(index: number) {
    setSectionIds(sectionIds.filter((_, i) => i !== index));
    edit({ ...content, sections: content.sections.filter((_, i) => i !== index) });
  }

  async function uploadLogo(file: File) {
    setLogoMessage(undefined);
    const body = new FormData();
    body.set("file", file);
    try {
      const response = await fetch(`/api/case-studies/${id}/logo`, { method: "POST", body });
      const data = (await response.json().catch(() => ({}))) as { path?: string; url?: string; message?: string };
      if (!response.ok || !data.path) return setLogoMessage(data.message ?? "The upload did not work. Please try again.");
      setLogoUrl(data.url ?? null);
      edit({ ...content, client: { ...content.client, logoPath: data.path } });
    } catch {
      setLogoMessage("The upload did not work. Please try again.");
    }
  }

  const watermark = templateLocked ? LOCKED_WATERMARK : undefined;
  const statusText = { saved: save.at ? `Saved at ${save.at}` : "All changes saved", saving: "Saving...", unsaved: "Unsaved changes", error: save.message ?? "Could not save" }[save.state];

  const panel = (
    <div className="space-y-6">
      <fieldset disabled={!canEdit} className="space-y-6 disabled:opacity-90">
        <section aria-labelledby="ed-brand" className="space-y-3">
          <h2 id="ed-brand" className="font-semibold">Client and logo</h2>
          {(["name", "company", "role"] as const).map((key) => (
            <div key={key} className="space-y-1">
              <label htmlFor={`client-${key}`} className="block text-sm font-medium capitalize">{key}</label>
              <input id={`client-${key}`} className={field} maxLength={120} value={content.client[key] ?? ""} onChange={(e) => edit({ ...content, client: { ...content.client, [key]: e.target.value || undefined } })} />
            </div>
          ))}
          <div className="space-y-1">
            <label htmlFor="logo-file" className="block text-sm font-medium">Logo (PNG, JPG or WebP, up to 2 MB)</label>
            <input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp" className="block w-full text-base file:mr-3 file:min-h-11 file:rounded-md file:border file:border-neutral-300 file:bg-transparent file:px-3" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadLogo(f); }} />
            {content.client.logoPath && (
              <button type="button" className={smallButton} onClick={() => { setLogoUrl(null); const { logoPath: _gone, ...rest } = content.client; void _gone; edit({ ...content, client: rest }); }}>Remove logo</button>
            )}
            <div role="alert" aria-live="polite">{logoMessage ? <p className="text-sm text-red-700 dark:text-red-400">{logoMessage}</p> : null}</div>
          </div>
        </section>

        <section aria-labelledby="ed-theme" className="space-y-3">
          <h2 id="ed-theme" className="font-semibold">Look</h2>
          <div className="space-y-1">
            <label htmlFor="theme-color" className="block text-sm font-medium">Accent colour</label>
            <div className="flex items-center gap-2">
              <input id="theme-color" type="color" value={/^#[0-9a-fA-F]{6}$/.test(theme.primary) ? theme.primary : "#1d4ed8"} onChange={(e) => patchTheme({ primary: e.target.value })} className="size-11 shrink-0 cursor-pointer rounded-md border border-neutral-300 bg-transparent p-1 dark:border-neutral-700" />
              <label htmlFor="theme-hex" className="sr-only">Accent colour hex value</label>
              <input id="theme-hex" className={field} value={theme.primary} maxLength={7} onChange={(e) => patchTheme({ primary: e.target.value })} aria-invalid={!themeValidation.success || undefined} />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="theme-font" className="block text-sm font-medium">Fonts</label>
            <Select id="theme-font" value={theme.fontPair} onChange={(e) => patchTheme({ fontPair: e.target.value as Theme["fontPair"] })} className="w-full">
              {FONT_PAIRS.map((pair) => <option key={pair} value={pair}>{FONT_PAIR_LABELS[pair]}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([["radius", "Corners", RADII], ["spacing", "Spacing", SPACINGS], ["mode", "Mode", MODES]] as const).map(([key, label, options]) => (
              <div key={key} className="space-y-1">
                <label htmlFor={`theme-${key}`} className="block text-sm font-medium">{label}</label>
                <Select id={`theme-${key}`} value={theme[key]} onChange={(e) => patchTheme({ [key]: e.target.value } as Partial<Theme>)} className="w-full">
                  {options.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="ed-content" className="space-y-4">
          <h2 id="ed-content" className="font-semibold">Content</h2>
          <div className="space-y-1">
            <label htmlFor="ed-headline" className="block text-sm font-medium">Headline</label>
            <input id="ed-headline" className={field} maxLength={120} value={content.headline} onChange={(e) => edit({ ...content, headline: e.target.value })} />
            {canEdit && <RefineControl caseStudyId={id} fieldPath="headline" currentText={content.headline} refined={refined.has("headline")} disabled={status === "published" || !validation.success} actions={props.refine} ensureSaved={ensureSaved} onApplied={applyServerText} />}
            {!canEdit && refined.has("headline") && <RefinedBadge />}
          </div>

          <ol className="space-y-4">
            {content.sections.map((section, index) => (
              <li
                key={sectionIds[index]}
                className="space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800"
                draggable={false}
                onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
                onDrop={(e) => {
                  e.preventDefault();
                  // The dragged position travels in the drag itself, which Firefox requires.
                  const from = Number(e.dataTransfer.getData(DRAG_TYPE));
                  if (Number.isInteger(from)) move(from, index);
                  setDragFrom(null);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    draggable={canEdit}
                    onDragStart={(e) => { setDragFrom(index); e.dataTransfer.setData(DRAG_TYPE, String(index)); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => setDragFrom(null)}
                    className="cursor-grab select-none text-sm font-medium uppercase tracking-wide text-neutral-600 dark:text-neutral-400"
                    title="Drag to reorder"
                  >
                    <span aria-hidden="true">⠿ </span>{section.type}
                  </span>
                  <div className="flex gap-1">
                    <button type="button" className={smallButton} onClick={() => move(index, index - 1)} disabled={index === 0} aria-label={`Move ${section.type} section up`}>↑</button>
                    <button type="button" className={smallButton} onClick={() => move(index, index + 1)} disabled={index === content.sections.length - 1} aria-label={`Move ${section.type} section down`}>↓</button>
                    <button type="button" className={smallButton} onClick={() => removeSection(index)} aria-label={`Remove ${section.type} section`}>Remove</button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor={`ed-title-${sectionIds[index]}`} className="block text-sm font-medium">Title</label>
                  <input id={`ed-title-${sectionIds[index]}`} className={field} maxLength={120} value={section.title} onChange={(e) => patchSection(index, { title: e.target.value })} />
                </div>
                {section.body !== undefined && (
                  <div className="space-y-1">
                    <label htmlFor={`ed-body-${sectionIds[index]}`} className="block text-sm font-medium">Text</label>
                    <textarea id={`ed-body-${sectionIds[index]}`} className={field} rows={4} maxLength={2000} value={section.body} onChange={(e) => patchSection(index, { body: e.target.value })} />
                    {canEdit && section.type !== "quote" && <RefineControl caseStudyId={id} fieldPath={`sections.${index}.body`} currentText={section.body} refined={refined.has(`sections.${index}.body`)} disabled={status === "published" || !validation.success} actions={props.refine} ensureSaved={ensureSaved} onApplied={applyServerText} />}
                    {!canEdit && refined.has(`sections.${index}.body`) && <RefinedBadge />}
                  </div>
                )}
                {section.metrics?.map((metric, mIndex) => {
                  const claim = claimOf.get(metric.claimId);
                  const edited = claim ? !numbersMatch(metric.value, claim) : true;
                  const setMetric = (patch: Partial<typeof metric>) => patchSection(index, { metrics: section.metrics?.map((m, i) => (i === mIndex ? { ...m, ...patch } : m)) });
                  return (
                    <div key={mIndex} className="space-y-2 rounded-md bg-neutral-50 p-3 dark:bg-neutral-900">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label htmlFor={`ed-ml-${sectionIds[index]}-${mIndex}`} className="block text-sm font-medium">Metric</label>
                          <input id={`ed-ml-${sectionIds[index]}-${mIndex}`} className={field} maxLength={80} value={metric.label} onChange={(e) => setMetric({ label: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor={`ed-mv-${sectionIds[index]}-${mIndex}`} className="block text-sm font-medium">Value</label>
                          <input id={`ed-mv-${sectionIds[index]}-${mIndex}`} className={field} maxLength={40} value={metric.value} onChange={(e) => setMetric({ value: e.target.value })} />
                        </div>
                      </div>
                      <Checkbox checked={!metric.hidden} onChange={(e) => setMetric({ hidden: e.target.checked ? undefined : true })}>Show this metric on the page</Checkbox>
                      <Source claim={claim} label={metric.label} />
                      <Flag edited={edited} wasConfirmed={claim?.confirmed ?? false} />
                    </div>
                  );
                })}
                {section.quote && (() => {
                  const quote = section.quote;
                  const claim = claimOf.get(quote.claimId);
                  const edited = claim ? !quoteMatches(quote.text, claim) : true;
                  return (
                    <div className="space-y-2 rounded-md bg-neutral-50 p-3 dark:bg-neutral-900">
                      <div className="space-y-1">
                        <label htmlFor={`ed-q-${sectionIds[index]}`} className="block text-sm font-medium">Quote</label>
                        <textarea id={`ed-q-${sectionIds[index]}`} className={field} rows={3} maxLength={500} value={quote.text} onChange={(e) => patchSection(index, { quote: { ...quote, text: e.target.value } })} />
                      </div>
                      <Source claim={claim} label="this quote" />
                      <Flag edited={edited} wasConfirmed={claim?.confirmed ?? false} />
                    </div>
                  );
                })()}
              </li>
            ))}
          </ol>

          <div className="space-y-1">
            <label htmlFor="add-section" className="block text-sm font-medium">Add a section</label>
            <Select id="add-section" value="" onChange={(e) => { if (e.target.value) addSection(e.target.value as (typeof ADDABLE)[number]); }} className="w-full">
              <option value="">Choose a type...</option>
              {ADDABLE.filter((t) => template.sectionTypes.includes(t)).map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">Numbers and quotes always come from what your client said, so they cannot be added by hand.</p>
          </div>
        </section>
      </fieldset>

      <PreviewLinks id={id} initial={props.previews} canEdit={canEdit} actions={actions} />
    </div>
  );

  return (
    <div className="space-y-4">
      <div role="note" className="rounded-md border border-amber-700/30 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-950 dark:bg-amber-950 dark:text-amber-100">
        Numbers must match what your client said.
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" role="status" className="text-sm text-neutral-600 dark:text-neutral-400">
          Version {version} · {status} · <span data-testid="save-status">{statusText}</span>
        </p>
        <div role="group" aria-label="Preview size" className="flex gap-1">
          {(Object.keys(DEVICES) as Device[]).map((d) => (
            <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)} className={`${smallButton} aria-pressed:bg-neutral-900 aria-pressed:text-white dark:aria-pressed:bg-neutral-100 dark:aria-pressed:text-neutral-900`}>{DEVICES[d].label}</button>
          ))}
        </div>
      </div>

      {templateLocked && (
        <p role="status" className="rounded-md border border-amber-700/30 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
          {template.name} is a paid template. You can preview it here with a watermark, but it cannot be published on your plan.
        </p>
      )}

      <div className="lg:grid lg:grid-cols-[24rem_1fr] lg:gap-6">
        {/* Control panel: a column on large screens, a bottom sheet on phones. */}
        <aside
          aria-label="Editor controls"
          className={`${sheetOpen ? "fixed inset-x-0 bottom-0 z-30 max-h-[75dvh] translate-y-0" : "hidden"} overflow-y-auto rounded-t-xl border border-neutral-200 bg-white p-4 shadow-2xl dark:border-neutral-800 dark:bg-neutral-950 lg:static lg:block lg:max-h-none lg:rounded-lg lg:shadow-none`}
        >
          <div className="mb-3 flex items-center justify-between lg:hidden">
            <p className="font-semibold">Edit</p>
            <button type="button" className={smallButton} onClick={() => setSheetOpen(false)}>Close</button>
          </div>
          {panel}
        </aside>

        <section aria-label="Live preview" className="mt-4 min-w-0 lg:mt-0">
          {!validation.success && (
            <p role="alert" className="mb-3 rounded-md border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
              {validation.error.issues[0]?.message ?? "Some fields are not valid."} Changes are not saved until this is fixed.
            </p>
          )}
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-100 p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div data-testid="preview-frame" data-device={device} style={{ width: DEVICES[device].width, maxWidth: "100%" }} className="mx-auto overflow-hidden rounded-md shadow">
              <CaseStudyView content={validation.success ? validation.data : props.initialContent} template={template} theme={themeValidation.success ? themeValidation.data : props.initialTheme} watermark={watermark} logoUrl={logoUrl} />
            </div>
          </div>

          <PublishPanel id={id} status={status} role={props.role} canEdit={canEdit} headline={content.headline} slug={props.slug} declined={props.declined} clientNote={props.clientNote} blockers={blockers} actions={actions} />
        </section>
      </div>

      {/* Phone: the controls open from the bottom. */}
      {!sheetOpen && (
        <button type="button" onClick={() => setSheetOpen(true)} className="fixed bottom-4 right-4 z-20 inline-flex min-h-12 items-center rounded-full bg-neutral-900 px-6 font-medium text-white shadow-lg lg:hidden dark:bg-neutral-100 dark:text-neutral-900">
          Edit
        </button>
      )}
      {canEdit && (
        <button type="button" onClick={() => void flush()} className={`${smallButton} hidden lg:inline-flex`}>Save now</button>
      )}
    </div>
  );
}

function PreviewLinks({ id, initial, canEdit, actions }: { id: string; initial: Array<{ id: string; expires: string }>; canEdit: boolean; actions: Props["actions"] }) {
  const [links, setLinks] = useState(initial);
  const [fresh, setFresh] = useState<string>();
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [pending, setPending] = useState(false);

  async function create() {
    setPending(true);
    setMessage(undefined);
    const result = await actions.createPreview(id);
    setPending(false);
    if (!result.ok || !result.link) return setMessage({ ok: false, text: result.message ?? "We could not create the link." });
    setFresh(result.link);
    const expires = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    setLinks([{ id: result.previewId ?? `new-${links.length}`, expires }, ...links]);
  }

  async function revoke(previewId: string) {
    if (previewId.startsWith("new-")) return setMessage({ ok: true, text: "Reload this page to manage the link you just created." });
    setPending(true);
    const result = await actions.revokePreview(id, previewId);
    setPending(false);
    setMessage({ ok: result.ok, text: result.message ?? "Done." });
    if (result.ok) setLinks(links.filter((l) => l.id !== previewId));
  }

  return (
    <section aria-labelledby="ed-previews" className="space-y-3">
      <h2 id="ed-previews" className="font-semibold">Share a preview</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">An unlisted link that shows this draft with a &ldquo;Draft - not published&rdquo; mark. It expires in 14 days and you can revoke it any time.</p>
      {canEdit && <button type="button" className={smallButton} onClick={create} disabled={pending}>Create preview link</button>}
      {fresh && (
        <div className="space-y-1 text-sm">
          <p className="font-medium">Preview link (shown once)</p>
          <input readOnly value={fresh} aria-label="Preview link" onFocus={(e) => e.currentTarget.select()} className={`${field} font-mono text-sm`} />
        </div>
      )}
      {links.length > 0 && (
        <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
          {links.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-2 px-3 py-1">
              <span>Expires {link.expires}</span>
              {canEdit && <button type="button" className={smallButton} onClick={() => revoke(link.id)} disabled={pending}>Revoke</button>}
            </li>
          ))}
        </ul>
      )}
      <div role="status" aria-live="polite">
        {message ? <p className={message.ok ? "text-sm text-green-800 dark:text-green-300" : "text-sm text-red-700 dark:text-red-400"}>{message.text}</p> : null}
      </div>
    </section>
  );
}

function PublishPanel({ id, status, role, canEdit, headline, slug, declined, clientNote, blockers, actions }: { id: string; status: string; role: string; canEdit: boolean; headline: string; slug: string | null; declined: boolean; clientNote: string | null; blockers: Blocker[]; actions: Props["actions"] }) {
  const router = useRouter();
  const [address, setAddress] = useState(slug ?? slugify(headline));
  const [link, setLink] = useState<string>();
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<{ which: "request" | "publish" | null; value: ButtonPhase }>({ which: null, value: "idle" });
  const canPublish = role === "admin" || role === "owner";

  async function run(action: () => Promise<LifecycleResult>, which: "request" | "publish" | null = null) {
    setPending(true);
    setMessage(undefined);
    setPhase({ which, value: "loading" });
    const result = await action();
    setPending(false);
    setPhase({ which, value: result.ok ? "success" : "idle" });
    if (result.ok) setTimeout(() => setPhase({ which: null, value: "idle" }), 1200);
    setMessage({ ok: result.ok, text: result.message ?? (result.ok ? "Done." : "Something went wrong.") });
    if (result.link) setLink(result.link);
    if (result.ok) router.refresh();
  }

  return (
    <section aria-labelledby="ed-publish" className="mt-4 space-y-3 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 id="ed-publish" className="font-semibold">Approval and publishing</h2>
      {declined && <p role="note" className="text-sm text-red-800 dark:text-red-300">The client declined this case study. It cannot be published.</p>}
      {clientNote && status === "draft" && (
        <p role="note" className="text-sm"><span className="font-medium">Your client asked for changes:</span> <span data-testid="client-note">{clientNote}</span></p>
      )}

      {!declined && (status === "draft" || status === "awaiting_client_approval") && canEdit && (
        <div className="space-y-2">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {status === "draft" ? "Your client approves this exact version by email. Editing afterwards cancels the request." : "Waiting for your client. A new link replaces the previous one."}
          </p>
          <LoadingButton type="button" phase={phase.which === "request" ? phase.value : "idle"} disabled={pending} onClick={() => run(() => actions.requestApproval(id), "request")} className={smallButton}>
            {status === "draft" ? "Request client approval and signature" : "Send a new signing link"}
          </LoadingButton>
        </div>
      )}

      {!declined && (status === "approved" || status === "unpublished") && canPublish && (
        <div className="space-y-2">
          <label htmlFor="ed-slug" className="block text-sm font-medium">Page address</label>
          <input id="ed-slug" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={60} className={`${field} font-mono`} />
          <LoadingButton type="button" phase={phase.which === "publish" ? phase.value : "idle"} disabled={pending || blockers.length > 0} onClick={() => run(() => actions.publish(id, address, headline), "publish")} className="min-h-11 rounded-md bg-neutral-900 px-5 text-base font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">Publish</LoadingButton>
        </div>
      )}
      {(status === "approved" || status === "unpublished") && !canPublish && <p className="text-sm text-neutral-600 dark:text-neutral-400">Approved by your client. An admin or owner can publish it.</p>}

      {status === "published" && canPublish && (
        <button type="button" disabled={pending} onClick={() => run(() => actions.unpublish(id))} className={smallButton}>Unpublish</button>
      )}

      {link && (
        <div className="space-y-1 text-sm">
          <p className="font-medium">Approval link (shown once)</p>
          <input readOnly value={link} aria-label="Approval link" onFocus={(e) => e.currentTarget.select()} className={`${field} font-mono text-sm`} />
          <CopyButton text={link} label="Copy link" />
        </div>
      )}
      {blockers.length > 0 && status !== "published" && (
        <div id="publish-why" className="text-sm text-neutral-600 dark:text-neutral-400">
          <p className="font-medium">Before this can go live</p>
          <ul className="list-disc pl-5">{blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
        </div>
      )}
      <div role="status" aria-live="polite">
        {message ? <p className={message.ok ? "text-sm text-green-800 dark:text-green-300" : "text-sm text-red-700 dark:text-red-400"}>{message.text}</p> : null}
      </div>
    </section>
  );
}

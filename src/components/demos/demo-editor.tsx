"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { addEmbedOriginAction, deleteDemoAction, publishDemoAction, removeEmbedOriginAction, saveDemoAction, unpublishDemoAction, type DemoActionResult } from "@/app/app/demos/actions";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, SectionLabel } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import type { TextFinding } from "@/lib/demos/redaction";
import type { DemoContent, DemoSettings, DemoTheme, Scene } from "@/lib/demos/schema";
import { AssetsPanel, assetSrc, type AssetView } from "./assets-panel";
import { DemoPlayer } from "./demo-player";
import { Field, TextArea, TextInput } from "./fields";
import { SceneForm } from "./scene-forms";

export interface EditorDemo {
  id: string;
  title: string;
  status: string;
  slug: string | null;
  content: DemoContent;
  settings: DemoSettings;
  theme: DemoTheme;
  attested: boolean;
  redacted: boolean;
}

const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
const LABEL: Record<Scene["type"], string> = { screenshot: "Screenshot step", chat: "Simulated chat", workflow: "Workflow", compare: "Before and after" };

function blankScene(type: Scene["type"], assets: AssetView[]): Scene {
  const a = assets[0]?.id ?? "00000000-0000-4000-8000-000000000000";
  const id = newId(type.slice(0, 3));
  if (type === "screenshot") return { id, type, assetId: a, hotspot: { x: 0.4, y: 0.4, w: 0.2, h: 0.1 }, tooltip: { title: "Click here", body: "", position: "bottom" }, blurs: [], next: "auto" };
  if (type === "chat") return { id, type, persona: { name: "Ava", role: "Support agent" }, messages: [{ from: "user", text: "", delayMs: 0 }, { from: "agent", text: "", delayMs: 600 }], choices: [] };
  if (type === "workflow") return { id, type, title: "How it works", nodes: [], edges: [] };
  return { id, type, beforeAssetId: a, afterAssetId: assets[1]?.id ?? a, beforeLabel: "Before", afterLabel: "After", caption: "" };
}

type Phase = "saved" | "dirty" | "saving" | "error";

export function DemoEditor({ demo, assets, role, origins, publicBase }: { demo: EditorDemo; assets: AssetView[]; role: string; origins: Array<{ id: string; origin: string }>; publicBase: string | null }) {
  const router = useRouter();
  const locked = demo.status === "published" || demo.status === "blocked";
  const canPublish = role === "owner" || role === "admin";
  const [title, setTitle] = useState(demo.title);
  const [scenes, setScenes] = useState<Scene[]>(demo.content.scenes);
  const [settings, setSettings] = useState(demo.settings);
  const [theme] = useState(demo.theme);
  const [attested, setAttested] = useState(demo.attested);
  const [redacted, setRedacted] = useState(demo.redacted);
  const [slug, setSlug] = useState(demo.slug ?? "");
  const [phase, setPhase] = useState<Phase>("saved");
  const [problems, setProblems] = useState<string[]>([]);
  const [findings, setFindings] = useState<TextFinding[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [newOrigin, setNewOrigin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const latest = useRef({ title, scenes, settings, attested, redacted });
  useEffect(() => { latest.current = { title, scenes, settings, attested, redacted }; });

  const unresolved = assets.filter((a) => a.flagged).length;
  const sceneIds = scenes.map((s) => s.id);

  async function save(): Promise<DemoActionResult> {
    setPhase("saving");
    const s = latest.current;
    const result = await saveDemoAction(demo.id, { title: s.title, content: { scenes: s.scenes }, settings: s.settings, authenticity_attested: s.attested, redaction_acknowledged: s.redacted });
    setPhase(result.ok ? "saved" : "error");
    setProblems(result.ok ? [] : [result.message ?? "We could not save.", ...(result.issues ?? [])]);
    if (result.ok) setFindings(result.findings ?? []);
    return result;
  }

  // Autosave a moment after the last change. The server validates everything again.
  useEffect(() => {
    if (rev === 0 || locked) return;
    const t = setTimeout(() => void save(), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  /** Every edit goes through here so the autosave timer restarts. */
  const edited = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPhase("dirty"); setRev((r) => r + 1); };
  const changeScenes = (fn: (list: Scene[]) => Scene[]) => { setScenes(fn); setPhase("dirty"); setRev((r) => r + 1); };
  const update = (i: number, scene: Scene) => changeScenes((list) => list.map((s, j) => (j === i ? scene : s)));
  const move = (i: number, d: -1 | 1) => changeScenes((list) => { const j = i + d; if (j < 0 || j >= list.length) return list; const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; return next; });
  const remove = (i: number) => changeScenes((list) => list.filter((_, j) => j !== i).map((s) => (s.type === "screenshot" && s.next === list[i].id ? { ...s, next: "auto" } : s.type === "chat" ? { ...s, choices: s.choices.filter((c) => c.goto !== list[i].id) } : s)));
  const setTitleE = edited(setTitle);
  const setSettingsE = edited(setSettings);
  const setAttestedE = edited(setAttested);
  const setRedactedE = edited(setRedacted);

  async function run(key: string, fn: () => Promise<DemoActionResult>, done?: (r: DemoActionResult) => void) {
    setBusy(key);
    setNotice(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setNotice(r.message ?? "That did not work.");
    else { done?.(r); router.refresh(); }
  }

  const publish = () => run("publish", async () => {
    const saved = await save();
    return saved.ok ? publishDemoAction(demo.id, slug) : { ok: false, message: "Fix the problems above, then publish." };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1"><Field label="Demo name"><TextInput value={title} maxLength={120} disabled={locked} onChange={(e) => setTitleE(e.target.value)} /></Field></div>
        <StatusPill status={demo.status} />
        <p role="status" className="text-sm text-muted">{{ saved: "Saved", dirty: "Unsaved changes", saving: "Saving…", error: "Not saved" }[phase]}</p>
      </div>

      {demo.status === "blocked" ? <Callout tone="warn">This demo has been blocked after a review and cannot be changed or published.</Callout> : null}
      {demo.status === "published" ? <Callout tone="info">This demo is live. Unpublish it to make changes.</Callout> : null}
      {problems.length ? <Callout tone="warn"><ul className="list-disc pl-4">{problems.slice(0, 6).map((p, i) => <li key={i}>{p}</li>)}</ul></Callout> : null}
      {findings.length ? <Callout tone="warn">Some text looks like it may contain private details ({[...new Set(findings.flatMap((f) => f.kinds))].join(", ")}). Check {findings.length === 1 ? "this step" : "these steps"}: {findings.map((f) => f.path.replace(/^scenes\.(\d+).*/, (_, n) => `step ${Number(n) + 1}`)).filter((v, i, a) => a.indexOf(v) === i).join(", ")}.</Callout> : null}

      <Card aria-labelledby="images">
        <SectionLabel id="images">Images</SectionLabel>
        <div className="mt-3"><AssetsPanel demoId={demo.id} assets={assets} locked={locked} onChanged={() => router.refresh()} /></div>
      </Card>

      <section aria-labelledby="steps" className="space-y-3">
        <SectionLabel id="steps">Steps</SectionLabel>
        {scenes.length === 0 ? <Card><p className="text-sm text-muted">No steps yet. Add the first one below.</p></Card> : null}
        {scenes.map((scene, i) => (
          <Card key={scene.id} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="mr-auto font-semibold">{i + 1}. {LABEL[scene.type]} <span className="text-xs font-normal text-muted">({scene.id})</span></h3>
              {!locked ? (
                <>
                  <Button size="sm" variant="quiet" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>Up</Button>
                  <Button size="sm" variant="quiet" aria-label={`Move step ${i + 1} down`} disabled={i === scenes.length - 1} onClick={() => move(i, 1)}>Down</Button>
                  <Button size="sm" variant="quiet" aria-label={`Delete step ${i + 1}`} onClick={() => remove(i)}>Delete</Button>
                </>
              ) : null}
            </div>
            <fieldset disabled={locked} className="min-w-0 border-0 p-0"><SceneForm scene={scene} onChange={(s) => update(i, s)} ctx={{ assets, sceneIds, disabled: locked }} /></fieldset>
          </Card>
        ))}
        {!locked && scenes.length < 40 ? (
          <div className="flex flex-wrap gap-2">
            {(["screenshot", "chat", "workflow", "compare"] as const).map((t) => <Button key={t} variant="secondary" size="sm" onClick={() => changeScenes((l) => [...l, blankScene(t, assets)])}>Add {LABEL[t].toLowerCase()}</Button>)}
          </div>
        ) : null}
      </section>

      <Card aria-labelledby="settings">
        <SectionLabel id="settings">Sharing</SectionLabel>
        <fieldset disabled={locked} className="mt-3 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-2">
          <Field label="Ask for an email">
            <Select value={settings.lead_gate} onChange={(e) => setSettingsE({ ...settings, lead_gate: e.target.value as DemoSettings["lead_gate"] })}>
              <option value="none">Never</option><option value="start">Before the demo</option><option value="end">At the end</option>
            </Select>
          </Field>
          <div />
          <Field label="Button text" hint="Shown at the end of the demo."><TextInput maxLength={40} value={settings.cta_text ?? ""} onChange={(e) => setSettingsE({ ...settings, cta_text: e.target.value || undefined })} /></Field>
          <Field label="Button link" hint="Must start with https://"><TextInput type="url" maxLength={500} value={settings.cta_url ?? ""} onChange={(e) => setSettingsE({ ...settings, cta_url: e.target.value || undefined })} /></Field>
          <div className="sm:col-span-2"><Checkbox checked={settings.allow_embed} onChange={(e) => setSettingsE({ ...settings, allow_embed: e.target.checked })}>Allow this demo to be embedded on other websites</Checkbox></div>
        </fieldset>
        {settings.allow_embed ? (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <p className="text-sm font-medium">Websites that may show this demo</p>
            <p className="text-xs text-muted">Only the websites listed here can embed it. Without one, embedding stays off.</p>
            <ul className="space-y-1 text-sm">
              {origins.map((o) => (
                <li key={o.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{o.origin}</span>
                  {canPublish ? <Button size="sm" variant="quiet" loading={busy === `rm-${o.id}`} onClick={() => run(`rm-${o.id}`, () => removeEmbedOriginAction(demo.id, o.id))}>Remove</Button> : null}
                </li>
              ))}
              {origins.length === 0 ? <li className="text-muted">None yet.</li> : null}
            </ul>
            {canPublish ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[14rem] flex-1"><Field label="Add a website"><TextInput type="url" placeholder="https://www.example.com" maxLength={300} value={newOrigin} onChange={(e) => setNewOrigin(e.target.value)} /></Field></div>
                <Button variant="secondary" loading={busy === "add-origin"} disabled={!newOrigin.trim()} onClick={() => run("add-origin", () => addEmbedOriginAction(demo.id, newOrigin), () => setNewOrigin(""))}>Add</Button>
              </div>
            ) : <p className="text-xs text-muted">Only admins can change this list.</p>}
            {origins.length > 0 && publicBase && demo.status === "published" && demo.slug ? (
              <Field label="Embed code" hint="Paste this into the page where the demo should appear.">
                <TextArea readOnly rows={3} value={`<iframe src="${publicBase}/demo/${demo.slug}/embed" title="${demo.title.replace(/[<>"&]/g, "")}" width="100%" height="640" style="border:0" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`} />
              </Field>
            ) : null}
          </div>
        ) : null}
        {publicBase && demo.status === "published" && demo.slug ? <p className="mt-4 text-sm">Public link: <a href={`${publicBase}/demo/${demo.slug}`} target="_blank" rel="noopener noreferrer" className="underline">{`${publicBase}/demo/${demo.slug}`}</a></p> : null}
      </Card>

      <Card aria-labelledby="preview">
        <SectionLabel id="preview">Preview</SectionLabel>
        <div className="mt-3"><DemoPlayer key={scenes.map((s) => s.id).join()} content={{ scenes }} theme={theme} assetSrc={assetSrc} /></div>
      </Card>

      <Card aria-labelledby="publish" tint>
        <SectionLabel id="publish">Publish</SectionLabel>
        <div className="mt-3 space-y-3">
          <Checkbox checked={attested} disabled={locked} onChange={(e) => setAttestedE(e.target.checked)}>This demo is a true example of how our product works. It does not misrepresent a customer, a result or a feature.</Checkbox>
          <Checkbox checked={redacted} disabled={locked} onChange={(e) => setRedactedE(e.target.checked)}>I checked every image and every line of text and removed names, emails, keys and other private information.</Checkbox>
          {unresolved > 0 ? <p className="text-sm text-[#8a5a00]">{unresolved} image{unresolved === 1 ? "" : "s"} still need{unresolved === 1 ? "s" : ""} confirming above.</p> : null}
          {notice ? <p role="alert" className="text-sm text-[#b42318]">{notice}</p> : null}
          {demo.status === "published" ? (
            canPublish ? <Button variant="secondary" loading={busy === "unpublish"} onClick={() => run("unpublish", () => unpublishDemoAction(demo.id))}>Unpublish</Button> : <p className="text-sm text-muted">Only admins can unpublish.</p>
          ) : canPublish ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[14rem] flex-1"><Field label="Page address" hint="3 to 40 lowercase letters, numbers and hyphens."><TextInput value={slug} maxLength={40} onChange={(e) => setSlug(e.target.value.toLowerCase())} /></Field></div>
              <Button loading={busy === "publish"} disabled={locked} onClick={publish}>Publish demo</Button>
            </div>
          ) : <p className="text-sm text-muted">Only admins can publish. Ask an admin when it is ready.</p>}
          {canPublish && !locked ? (
            <Button variant="quiet" size="sm" loading={busy === "delete"} onClick={() => { if (window.confirm("Delete this demo and its images? This cannot be undone.")) void run("delete", () => deleteDemoAction(demo.id), () => router.push("/app/demos")); }}>Delete demo</Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

"use client";

import { useState } from "react";
import { draftChatAction, suggestTooltipAction } from "@/app/app/demos/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { NODE_TYPES, TOOLTIP_POSITIONS, type ChatScene, type CompareScene, type Scene, type ScreenshotScene, type WorkflowScene } from "@/lib/demos/schema";
import { assetSrc, type AssetView } from "./assets-panel";
import { Field, TextArea, TextInput } from "./fields";
import { RegionPicker } from "./region-picker";

interface Ctx { assets: AssetView[]; sceneIds: string[]; disabled: boolean }
const imageName = (assets: AssetView[], id: string) => `Image ${assets.findIndex((a) => a.id === id) + 1}`;

function AssetSelect({ assets, value, onChange, label }: { assets: AssetView[]; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {!assets.some((a) => a.id === value) ? <option value={value}>Choose an image</option> : null}
        {assets.map((a, i) => <option key={a.id} value={a.id}>Image {i + 1}</option>)}
      </Select>
    </Field>
  );
}

/** A small "describe it, get a suggestion" box. The suggestion fills the form; nothing is saved until the owner saves. */
function Suggest({ label, run, disabled }: { label: string; run: (notes: string) => Promise<string | null>; disabled: boolean }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <details className="rounded-control border border-line px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">{label}</summary>
      <div className="mt-2 space-y-2">
        <TextArea value={notes} maxLength={600} placeholder="Describe it in a sentence or two" aria-label="Notes for the AI" onChange={(e) => setNotes(e.target.value)} />
        <Button size="sm" variant="secondary" loading={busy} disabled={disabled || notes.trim().length < 3} onClick={async () => { setBusy(true); setError(await run(notes)); setBusy(false); }}>Suggest</Button>
        <p className="text-xs text-muted">The AI only suggests. Read it, edit it, then save. Do not paste private details.</p>
        {error ? <p role="alert" className="text-sm text-[#b42318]">{error}</p> : null}
      </div>
    </details>
  );
}

function ScreenshotForm({ scene, onChange, ctx }: { scene: ScreenshotScene; onChange: (s: ScreenshotScene) => void; ctx: Ctx }) {
  const hasImage = ctx.assets.some((a) => a.id === scene.assetId);
  return (
    <div className="space-y-3">
      <AssetSelect assets={ctx.assets} value={scene.assetId} label="Screenshot" onChange={(assetId) => onChange({ ...scene, assetId })} />
      {hasImage ? (
        <Field label="Where the viewer clicks" hint="Drag on the picture to draw the clickable area.">
          <RegionPicker src={assetSrc(scene.assetId)} single value={[scene.hotspot]} onChange={(r) => r[0] && onChange({ ...scene, hotspot: r[0] })} label={`Click area on ${imageName(ctx.assets, scene.assetId)}`} />
        </Field>
      ) : <p className="text-sm text-muted">Upload an image above, then pick it here.</p>}
      <Field label="Tooltip title"><TextInput maxLength={80} value={scene.tooltip.title} onChange={(e) => onChange({ ...scene, tooltip: { ...scene.tooltip, title: e.target.value } })} /></Field>
      <Field label="Tooltip text"><TextArea maxLength={280} value={scene.tooltip.body} onChange={(e) => onChange({ ...scene, tooltip: { ...scene.tooltip, body: e.target.value } })} /></Field>
      <Field label="Tooltip position">
        <Select value={scene.tooltip.position} onChange={(e) => onChange({ ...scene, tooltip: { ...scene.tooltip, position: e.target.value as ScreenshotScene["tooltip"]["position"] } })}>
          {TOOLTIP_POSITIONS.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
        </Select>
      </Field>
      <Field label="After this step">
        <Select value={scene.next} onChange={(e) => onChange({ ...scene, next: e.target.value })}>
          <option value="auto">Go to the next step</option>
          {ctx.sceneIds.filter((id) => id !== scene.id).map((id) => <option key={id} value={id}>Jump to {id}</option>)}
        </Select>
      </Field>
      <Suggest label="Suggest tooltip text" disabled={ctx.disabled} run={async (notes) => { const r = await suggestTooltipAction(notes); if (r.ok && r.tooltip) onChange({ ...scene, tooltip: { ...scene.tooltip, ...r.tooltip } }); return r.ok ? null : (r.message ?? "No suggestion."); }} />
    </div>
  );
}

function ChatForm({ scene, onChange, ctx }: { scene: ChatScene; onChange: (s: ChatScene) => void; ctx: Ctx }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">This is shown to viewers as a simulated example. Do not paste real customer conversations.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><TextInput maxLength={40} value={scene.persona.name} onChange={(e) => onChange({ ...scene, persona: { ...scene.persona, name: e.target.value } })} /></Field>
        <Field label="Role"><TextInput maxLength={60} value={scene.persona.role} onChange={(e) => onChange({ ...scene, persona: { ...scene.persona, role: e.target.value } })} /></Field>
      </div>
      <ul className="space-y-2">
        {scene.messages.map((m, i) => (
          <li key={i} className="grid gap-2 rounded-control border border-line p-2 sm:grid-cols-[8rem_1fr_6rem_auto]">
            <Select aria-label={`Message ${i + 1} from`} value={m.from} onChange={(e) => onChange({ ...scene, messages: scene.messages.map((x, j) => (j === i ? { ...x, from: e.target.value as "user" | "agent" } : x)) })}>
              <option value="user">Customer</option><option value="agent">Agent</option>
            </Select>
            <TextInput aria-label={`Message ${i + 1} text`} maxLength={500} value={m.text} onChange={(e) => onChange({ ...scene, messages: scene.messages.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
            <TextInput aria-label={`Message ${i + 1} delay in milliseconds`} type="number" min={0} max={3000} step={100} value={m.delayMs} onChange={(e) => onChange({ ...scene, messages: scene.messages.map((x, j) => (j === i ? { ...x, delayMs: Math.min(3000, Math.max(0, Math.round(Number(e.target.value) || 0))) } : x)) })} />
            <Button size="sm" variant="quiet" onClick={() => onChange({ ...scene, messages: scene.messages.filter((_, j) => j !== i) })}>Remove</Button>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="secondary" disabled={scene.messages.length >= 40} onClick={() => onChange({ ...scene, messages: [...scene.messages, { from: scene.messages.at(-1)?.from === "user" ? "agent" : "user", text: "", delayMs: 600 }] })}>Add a message</Button>
      <Field label="Choices at the end" hint="Up to 4. Each one jumps to another step. Leave empty for a Next button.">
        <div className="space-y-2">
          {scene.choices.map((c, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_12rem_auto]">
              <TextInput aria-label={`Choice ${i + 1} label`} maxLength={60} value={c.label} onChange={(e) => onChange({ ...scene, choices: scene.choices.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <Select aria-label={`Choice ${i + 1} goes to`} value={c.goto} onChange={(e) => onChange({ ...scene, choices: scene.choices.map((x, j) => (j === i ? { ...x, goto: e.target.value } : x)) })}>
                {ctx.sceneIds.map((id) => <option key={id} value={id}>{id}</option>)}
              </Select>
              <Button size="sm" variant="quiet" onClick={() => onChange({ ...scene, choices: scene.choices.filter((_, j) => j !== i) })}>Remove</Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" disabled={scene.choices.length >= 4} onClick={() => onChange({ ...scene, choices: [...scene.choices, { label: "", goto: ctx.sceneIds.find((id) => id !== scene.id) ?? scene.id }] })}>Add a choice</Button>
        </div>
      </Field>
      <Suggest label="Draft the conversation" disabled={ctx.disabled} run={async (notes) => { const r = await draftChatAction(notes); if (r.ok && r.messages) onChange({ ...scene, messages: r.messages.map((m) => ({ ...m, delayMs: 600 })) }); return r.ok ? null : (r.message ?? "No suggestion."); }} />
    </div>
  );
}

function WorkflowForm({ scene, onChange }: { scene: WorkflowScene; onChange: (s: WorkflowScene) => void }) {
  const nodeId = () => `n-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div className="space-y-3">
      <Field label="Title"><TextInput maxLength={80} value={scene.title} onChange={(e) => onChange({ ...scene, title: e.target.value })} /></Field>
      <ul className="space-y-2">
        {scene.nodes.map((n, i) => (
          <li key={n.id} className="grid gap-2 rounded-control border border-line p-2 sm:grid-cols-[8rem_1fr_1fr_8rem_auto]">
            <Select aria-label={`Step ${i + 1} type`} value={n.type} onChange={(e) => onChange({ ...scene, nodes: scene.nodes.map((x, j) => (j === i ? { ...x, type: e.target.value as typeof n.type } : x)) })}>
              {NODE_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </Select>
            <TextInput aria-label={`Step ${i + 1} label`} placeholder="Label" maxLength={60} value={n.label} onChange={(e) => onChange({ ...scene, nodes: scene.nodes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
            <TextInput aria-label={`Step ${i + 1} detail`} placeholder="Detail" maxLength={200} value={n.detail} onChange={(e) => onChange({ ...scene, nodes: scene.nodes.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)) })} />
            <TextInput aria-label={`Step ${i + 1} app`} placeholder="App" maxLength={40} value={n.appName} onChange={(e) => onChange({ ...scene, nodes: scene.nodes.map((x, j) => (j === i ? { ...x, appName: e.target.value } : x)) })} />
            <Button size="sm" variant="quiet" onClick={() => onChange({ ...scene, nodes: scene.nodes.filter((_, j) => j !== i), edges: scene.edges.filter((e) => e.from !== n.id && e.to !== n.id) })}>Remove</Button>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="secondary" disabled={scene.nodes.length >= 12} onClick={() => {
        const id = nodeId();
        const prev = scene.nodes.at(-1);
        onChange({ ...scene, nodes: [...scene.nodes, { id, type: "action", label: "", detail: "", appName: "" }], edges: prev ? [...scene.edges, { from: prev.id, to: id }] : scene.edges });
      }}>Add a step</Button>
      <p className="text-xs text-muted">Steps run in order. Each new step is connected to the one before it.</p>
    </div>
  );
}

function CompareForm({ scene, onChange, ctx }: { scene: CompareScene; onChange: (s: CompareScene) => void; ctx: Ctx }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <AssetSelect assets={ctx.assets} value={scene.beforeAssetId} label="Before image" onChange={(beforeAssetId) => onChange({ ...scene, beforeAssetId })} />
      <AssetSelect assets={ctx.assets} value={scene.afterAssetId} label="After image" onChange={(afterAssetId) => onChange({ ...scene, afterAssetId })} />
      <Field label="Before label"><TextInput maxLength={40} value={scene.beforeLabel} onChange={(e) => onChange({ ...scene, beforeLabel: e.target.value })} /></Field>
      <Field label="After label"><TextInput maxLength={40} value={scene.afterLabel} onChange={(e) => onChange({ ...scene, afterLabel: e.target.value })} /></Field>
      <div className="sm:col-span-2"><Field label="Caption"><TextArea maxLength={200} value={scene.caption} onChange={(e) => onChange({ ...scene, caption: e.target.value })} /></Field></div>
    </div>
  );
}

export function SceneForm({ scene, onChange, ctx }: { scene: Scene; onChange: (s: Scene) => void; ctx: Ctx }) {
  if (scene.type === "screenshot") return <ScreenshotForm scene={scene} onChange={onChange} ctx={ctx} />;
  if (scene.type === "chat") return <ChatForm scene={scene} onChange={onChange} ctx={ctx} />;
  if (scene.type === "workflow") return <WorkflowForm scene={scene} onChange={onChange} />;
  return <CompareForm scene={scene} onChange={onChange} ctx={ctx} />;
}

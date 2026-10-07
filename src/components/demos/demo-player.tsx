"use client";

import { useState } from "react";
import { nextSceneIndex, type ChatScene, type CompareScene, type DemoContent, type DemoTheme, type Rect, type ScreenshotScene, type WorkflowScene } from "@/lib/demos/schema";

// Plays a demo. Everything is rendered as React text nodes (never HTML), and no scene contains a real input:
// the only controls are buttons that move between scenes. Images come from `assetSrc`, which the caller builds
// from a fixed route, so a scene can never point at an arbitrary URL.

interface Props {
  content: DemoContent;
  theme: DemoTheme;
  assetSrc: (assetId: string) => string;
  onStep?: (index: number) => void;
  onComplete?: () => void;
}

const pct = (n: number) => `${(n * 100).toFixed(3)}%`;
const boxStyle = (r: Rect) => ({ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) });

export function DemoPlayer({ content, theme, assetSrc, onStep, onComplete }: Props) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const scenes = content.scenes;
  const scene = scenes[index];
  const accent = { "--demo-accent": theme.primary } as React.CSSProperties;

  function go(target?: string) {
    const to = nextSceneIndex(scenes, index, target);
    if (to < 0) {
      setDone(true);
      onComplete?.();
      return;
    }
    setIndex(to);
    onStep?.(to);
  }

  if (!scene) return <p className="text-sm text-[var(--muted)]">This demo has no steps yet.</p>;
  if (done) {
    return (
      <div className="demo-player rounded-2xl border border-[var(--border)] bg-white p-8 text-center" style={accent}>
        <p className="text-lg font-semibold">That is the end of the demo.</p>
        <button type="button" className="mt-4 text-sm underline-offset-2 hover:underline" onClick={() => { setDone(false); setIndex(0); onStep?.(0); }}>
          Watch again
        </button>
      </div>
    );
  }

  return (
    <div className="demo-player rounded-2xl border border-[var(--border)] bg-white p-3 sm:p-4" style={accent} data-scene-type={scene.type}>
      {scene.type === "screenshot" && <Screenshot scene={scene} assetSrc={assetSrc} onNext={() => go(scene.next)} />}
      {scene.type === "chat" && <Chat key={scene.id} scene={scene} onGoto={(id) => go(id)} onNext={() => go()} />}
      {scene.type === "workflow" && <Workflow scene={scene} onNext={() => go()} />}
      {scene.type === "compare" && <Compare scene={scene} assetSrc={assetSrc} onNext={() => go()} />}
      <p className="mt-3 text-center text-xs text-[var(--muted)]">Step {index + 1} of {scenes.length}</p>
    </div>
  );
}

function NextButton({ onClick, label = "Next" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full bg-[var(--demo-accent)] px-4 py-2 text-sm font-semibold text-white">
      {label}
    </button>
  );
}

function Screenshot({ scene, assetSrc, onNext }: { scene: ScreenshotScene; assetSrc: Props["assetSrc"]; onNext: () => void }) {
  const { tooltip, hotspot } = scene;
  return (
    <div>
      <div className="relative overflow-hidden rounded-lg border border-[var(--border)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetSrc(scene.assetId)} alt="" className="block h-auto w-full" draggable={false} />
        {scene.blurs.map((b, i) => (
          <span key={i} aria-hidden className="absolute backdrop-blur-md" style={boxStyle(b)} />
        ))}
        <button type="button" aria-label={tooltip.title} onClick={onNext} className="absolute rounded-md border-2 border-[var(--demo-accent)]" style={boxStyle(hotspot)} />
      </div>
      <div className="mt-3 rounded-lg bg-[var(--tint,#FFF1EB)] p-3" data-tooltip-position={tooltip.position}>
        <p className="font-semibold">{tooltip.title}</p>
        {tooltip.body && <p className="mt-1 text-sm text-[var(--muted)]">{tooltip.body}</p>}
      </div>
    </div>
  );
}

function Chat({ scene, onGoto, onNext }: { scene: ChatScene; onGoto: (id: string) => void; onNext: () => void }) {
  return (
    <div>
      <p className="mb-2 inline-block rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium" data-simulated="true">
        Simulated example
      </p>
      <p className="text-sm font-semibold">
        {scene.persona.name}
        {scene.persona.role && <span className="font-normal text-[var(--muted)]"> · {scene.persona.role}</span>}
      </p>
      <ol className="mt-3 space-y-2">
        {scene.messages.map((m, i) => (
          <li key={i} className={m.from === "user" ? "flex justify-end" : "flex"} style={{ animationDelay: `${m.delayMs}ms` }}>
            <span className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.from === "user" ? "bg-[var(--demo-accent)] text-white" : "bg-[#F5F5F4]"}`}>{m.text}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        {scene.choices.length > 0 ? scene.choices.map((c, i) => (
          <button key={i} type="button" onClick={() => onGoto(c.goto)} className="rounded-full border border-[var(--demo-accent)] px-3 py-1.5 text-sm">{c.label}</button>
        )) : <NextButton onClick={onNext} />}
      </div>
    </div>
  );
}

function Workflow({ scene, onNext }: { scene: WorkflowScene; onNext: () => void }) {
  const target = (id: string) => scene.nodes.find((n) => n.id === id)?.label;
  return (
    <div>
      <p className="font-semibold">{scene.title}</p>
      <ol className="mt-3 space-y-2">
        {scene.nodes.map((n, i) => (
          <li key={n.id} className="rounded-lg border border-[var(--border)] p-3" data-node-type={n.type}>
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{i + 1}. {n.type}{n.appName && ` · ${n.appName}`}</p>
            <p className="font-medium">{n.label}</p>
            {n.detail && <p className="text-sm text-[var(--muted)]">{n.detail}</p>}
            {scene.edges.filter((e) => e.from === n.id).map((e, j) => (
              <p key={j} className="text-xs text-[var(--muted)]">then: {target(e.to)}</p>
            ))}
          </li>
        ))}
      </ol>
      <div className="mt-4"><NextButton onClick={onNext} /></div>
    </div>
  );
}

function Compare({ scene, assetSrc, onNext }: { scene: CompareScene; assetSrc: Props["assetSrc"]; onNext: () => void }) {
  const pane = (id: string, label: string) => (
    <figure className="min-w-0 flex-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={assetSrc(id)} alt="" className="block h-auto w-full rounded-lg border border-[var(--border)]" draggable={false} />
      {label && <figcaption className="mt-1 text-center text-xs text-[var(--muted)]">{label}</figcaption>}
    </figure>
  );
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row">{pane(scene.beforeAssetId, scene.beforeLabel)}{pane(scene.afterAssetId, scene.afterLabel)}</div>
      {scene.caption && <p className="mt-3 text-sm">{scene.caption}</p>}
      <div className="mt-4"><NextButton onClick={onNext} /></div>
    </div>
  );
}

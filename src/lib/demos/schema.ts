import { z } from "zod";
import { looksLikeHtml } from "@/lib/case-study/schema";

// Demo content is structured JSON, never HTML. Every string is length limited, stripped of control and invisible
// characters, and rejected if it looks like markup ("<" followed by a letter). Nothing in here can hold a script,
// a link target or an input field: scenes only describe screenshots, a simulated chat, a workflow and a comparison.

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-\u200F\u202A-\u202E⁠-⁤\u2066-\u2069﻿]/g;

const safeText = (max: number, { min = 0 }: { min?: number } = {}) =>
  z
    .string()
    .transform((value) => value.replace(CONTROL_CHARS, "").trim())
    .pipe(
      z
        .string()
        .min(min, min > 0 ? "Required" : undefined)
        .max(max, `Keep it under ${max} characters`)
        .refine((value) => !looksLikeHtml(value), "HTML is not allowed"),
    );

export const MAX_SCENES = 40;
export const MAX_NODES = 12;
export const SCENE_TYPES = ["screenshot", "chat", "workflow", "compare"] as const;
export const TOOLTIP_POSITIONS = ["top", "bottom", "left", "right"] as const;
export const NODE_TYPES = ["trigger", "action", "condition", "result"] as const;

/** A scene or node id: lowercase letters, digits and hyphens. */
const localId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Use lowercase letters, numbers and hyphens");
const assetId = z.uuid();
const fraction = z.number().min(0).max(1);

/** A rectangle as fractions (0 to 1) of the image's width and height. */
export const rectSchema = z
  .object({ x: fraction, y: fraction, w: fraction, h: fraction })
  .strict()
  .refine((r) => r.w > 0 && r.h > 0 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, "The box must sit inside the image");

const next = z.union([z.literal("auto"), localId]);

export const tooltipSchema = z.object({ title: safeText(80, { min: 1 }), body: safeText(280), position: z.enum(TOOLTIP_POSITIONS) }).strict();
export const chatMessageSchema = z.object({ from: z.enum(["user", "agent"]), text: safeText(500, { min: 1 }), delayMs: z.number().int().min(0).max(3000) }).strict();

export const screenshotSceneSchema = z
  .object({
    id: localId,
    type: z.literal("screenshot"),
    assetId,
    hotspot: rectSchema,
    tooltip: tooltipSchema,
    blurs: z.array(rectSchema).max(20).default([]),
    next: next.default("auto"),
  })
  .strict();

export const chatSceneSchema = z
  .object({
    id: localId,
    type: z.literal("chat"),
    persona: z.object({ name: safeText(40, { min: 1 }), role: safeText(60) }).strict(),
    messages: z.array(chatMessageSchema).max(40),
    choices: z.array(z.object({ label: safeText(60, { min: 1 }), goto: localId }).strict()).max(4).default([]),
  })
  .strict();

export const workflowSceneSchema = z
  .object({
    id: localId,
    type: z.literal("workflow"),
    title: safeText(80, { min: 1 }),
    nodes: z.array(z.object({ id: localId, type: z.enum(NODE_TYPES), label: safeText(60, { min: 1 }), detail: safeText(200), appName: safeText(40) }).strict()).max(MAX_NODES),
    edges: z.array(z.object({ from: localId, to: localId }).strict()).max(MAX_NODES * 2),
  })
  .strict();

export const compareSceneSchema = z
  .object({
    id: localId,
    type: z.literal("compare"),
    beforeAssetId: assetId,
    afterAssetId: assetId,
    beforeLabel: safeText(40),
    afterLabel: safeText(40),
    caption: safeText(200),
  })
  .strict();

export const sceneSchema = z.discriminatedUnion("type", [screenshotSceneSchema, chatSceneSchema, workflowSceneSchema, compareSceneSchema]);

export const demoContentSchema = z
  .object({ scenes: z.array(sceneSchema).max(MAX_SCENES) })
  .strict()
  .superRefine((content, ctx) => {
    const ids = new Set<string>();
    content.scenes.forEach((scene, i) => {
      if (ids.has(scene.id)) ctx.addIssue({ code: "custom", path: ["scenes", i, "id"], message: "Scene ids must be unique" });
      ids.add(scene.id);
    });
    content.scenes.forEach((scene, i) => {
      if (scene.type === "screenshot" && scene.next !== "auto" && !ids.has(scene.next)) ctx.addIssue({ code: "custom", path: ["scenes", i, "next"], message: "That scene does not exist" });
      if (scene.type === "chat") scene.choices.forEach((c, j) => { if (!ids.has(c.goto)) ctx.addIssue({ code: "custom", path: ["scenes", i, "choices", j, "goto"], message: "That scene does not exist" }); });
      if (scene.type === "workflow") {
        const nodeIds = new Set<string>();
        scene.nodes.forEach((n, j) => {
          if (nodeIds.has(n.id)) ctx.addIssue({ code: "custom", path: ["scenes", i, "nodes", j, "id"], message: "Node ids must be unique" });
          nodeIds.add(n.id);
        });
        scene.edges.forEach((e, j) => {
          if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) ctx.addIssue({ code: "custom", path: ["scenes", i, "edges", j], message: "An edge must join two nodes of this scene" });
        });
      }
    });
  });

/** https only, a real hostname, no credentials, no whitespace. */
const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.username === "" && url.password === "" && url.hostname.includes(".");
    } catch {
      return false;
    }
  }, "Enter a full https:// address");

export const demoSettingsSchema = z
  .object({
    lead_gate: z.enum(["none", "start", "end"]).default("none"),
    cta_text: safeText(40).optional(),
    cta_url: httpsUrl.optional(),
    allow_embed: z.boolean().default(false),
  })
  .strict()
  .refine((s) => !s.cta_url || (s.cta_text ?? "").length > 0, { message: "Add the button text", path: ["cta_text"] });

export const demoThemeSchema = z
  .object({ primary: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #ff5a1f").default("#ff5a1f"), rounded: z.boolean().default(true) })
  .strict();

export type DemoContent = z.infer<typeof demoContentSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type ScreenshotScene = z.infer<typeof screenshotSceneSchema>;
export type ChatScene = z.infer<typeof chatSceneSchema>;
export type WorkflowScene = z.infer<typeof workflowSceneSchema>;
export type CompareScene = z.infer<typeof compareSceneSchema>;
export type DemoSettings = z.infer<typeof demoSettingsSchema>;
export type DemoTheme = z.infer<typeof demoThemeSchema>;
export type Rect = z.infer<typeof rectSchema>;

/** Every image a demo points at. */
export function assetIdsIn(content: DemoContent): string[] {
  const ids = new Set<string>();
  for (const scene of content.scenes) {
    if (scene.type === "screenshot") ids.add(scene.assetId);
    if (scene.type === "compare") { ids.add(scene.beforeAssetId); ids.add(scene.afterAssetId); }
  }
  return [...ids];
}

/**
 * Validates untrusted content and checks that every image belongs to this demo. `allowedAssetIds` must come from the
 * database (the demo_assets rows of THIS workspace and demo), never from the request.
 */
export function validateDemoContent(raw: unknown, allowedAssetIds: ReadonlySet<string>): { ok: true; content: DemoContent } | { ok: false; issues: string[] } {
  const parsed = demoContentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join(".") || "content"}: ${i.message}`) };
  const foreign = assetIdsIn(parsed.data).filter((id) => !allowedAssetIds.has(id));
  if (foreign.length > 0) return { ok: false, issues: ["An image does not belong to this demo"] };
  return { ok: true, content: parsed.data };
}

/** The scene to show after this one: its explicit target, or the next in order. -1 means the end. */
export function nextSceneIndex(scenes: Scene[], index: number, target?: string): number {
  if (target && target !== "auto") {
    const found = scenes.findIndex((s) => s.id === target);
    if (found >= 0) return found;
  }
  return index + 1 < scenes.length ? index + 1 : -1;
}

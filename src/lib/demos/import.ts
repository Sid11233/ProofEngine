import { z } from "zod";
import { MAX_SCENES, chatSceneSchema, workflowSceneSchema, type Scene } from "./schema";

// Importing scenes written by the owner's own AI assistant. The text is untrusted: it goes through the same schemas as
// anything typed in the editor (plain text only, markup rejected, strict fields). Only chat and workflow scenes can be
// imported: screenshot and before/after scenes need images that belong to this demo, which an assistant cannot upload.

const importSchema = z.object({ scenes: z.array(z.discriminatedUnion("type", [chatSceneSchema, workflowSceneSchema])).min(1).max(MAX_SCENES) }).strict();

/** The first JSON object in the text, so a pasted answer with a sentence or a ```json fence around it still works. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const uid = () => Math.random().toString(36).slice(2, 8);

export type ImportResult = { ok: true; scenes: Scene[] } | { ok: false; message: string };

/**
 * Validates pasted text and returns scenes with fresh ids (so they never collide with the demo's own), with every jump
 * target rewritten to match. A jump to a scene that is not in the pasted text is rejected.
 */
export function parseImport(text: string, room: number): ImportResult {
  if (text.length > 100_000) return { ok: false, message: "That is too long to import." };
  const raw = extractJsonObject(text);
  if (raw === null) return { ok: false, message: "We could not find JSON in that text. Paste exactly what your assistant produced." };
  const parsed = importSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `${issue?.path.join(".") || "content"}: ${issue?.message ?? "not valid"}` };
  }
  if (parsed.data.scenes.length > room) return { ok: false, message: `A demo can have at most ${MAX_SCENES} steps; there is room for ${Math.max(room, 0)} more.` };

  const idMap = new Map<string, string>();
  for (const s of parsed.data.scenes) {
    if (idMap.has(s.id)) return { ok: false, message: `Two steps share the id "${s.id}".` };
    idMap.set(s.id, `${s.type.slice(0, 3)}-${uid()}`);
  }
  const scenes: Scene[] = [];
  for (const s of parsed.data.scenes) {
    const id = idMap.get(s.id)!;
    if (s.type === "chat") {
      const choices = s.choices.map((c) => ({ ...c, goto: idMap.get(c.goto) ?? "" }));
      if (choices.some((c) => !c.goto)) return { ok: false, message: `A choice in "${s.id}" jumps to a step that is not in the text.` };
      scenes.push({ ...s, id, choices });
    } else {
      const nodeIds = new Set(s.nodes.map((n) => n.id));
      if (s.edges.some((e) => !nodeIds.has(e.from) || !nodeIds.has(e.to))) return { ok: false, message: `An arrow in "${s.id}" points at a missing box.` };
      scenes.push({ ...s, id });
    }
  }
  return { ok: true, scenes };
}

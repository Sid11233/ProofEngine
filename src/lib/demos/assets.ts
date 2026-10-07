import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reencodeToWebp } from "@/lib/uploads/process";
import type { UploadStore } from "@/lib/uploads/store";
import { detectImageType, extensionOf, ALLOWED_EXTENSIONS, type UploadError } from "@/lib/uploads/validate";
import { pixelateRegions } from "./blur";
import type { Rect } from "./schema";

export const DEMO_BUCKET = "demo-assets";
export const MAX_DEMO_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_DEMO_DIMENSION = 1800;
export const FLAG_REASON = "Confirm this image shows no personal data, secrets or other people's information.";

export type DemoAssetKind = "screenshot" | "image" | "logo";
export type DemoAssetError = UploadError | "limit_reached" | "failed" | "not_found";
export type StoreAssetResult = { ok: true; id: string; width: number; height: number } | { ok: false; error: DemoAssetError };

/** `{workspace_id}/{demo_id}/{uuid}.webp`: the shape the table constraint accepts. The file name is never used. */
export const demoAssetPath = (workspaceId: string, demoId: string) => `${workspaceId}/${demoId}/${randomUUID()}.webp`;

export function validateDemoUpload(filename: string, bytes: Uint8Array): { ok: true } | { ok: false; error: UploadError } {
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > MAX_DEMO_UPLOAD_BYTES) return { ok: false, error: "too_large" };
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(extensionOf(filename))) return { ok: false, error: "bad_extension" };
  return detectImageType(bytes) ? { ok: true } : { ok: false, error: "bad_content" };
}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/**
 * Validate, re-encode (metadata and hidden payloads dropped), store privately, then record. New images are
 * recorded as FLAGGED: the owner must confirm each one (or pixelate it) before the demo can be published.
 * The caller has already authenticated the user and checked role and demo ownership.
 */
export async function storeDemoAsset(
  deps: { admin: SupabaseClient; store: UploadStore },
  ctx: { workspaceId: string; demoId: string },
  input: { filename: string; bytes: Uint8Array; kind: DemoAssetKind },
): Promise<StoreAssetResult> {
  const checked = validateDemoUpload(input.filename, input.bytes);
  if (!checked.ok) return checked;
  let image;
  try {
    image = await reencodeToWebp(input.bytes, MAX_DEMO_DIMENSION);
  } catch {
    return { ok: false, error: "bad_content" };
  }
  const path = demoAssetPath(ctx.workspaceId, ctx.demoId);
  if (!(await deps.store.put(path, image.data, "image/webp"))) return { ok: false, error: "failed" };
  const { data, error } = await deps.admin
    .from("demo_assets")
    .insert({
      workspace_id: ctx.workspaceId, demo_id: ctx.demoId, file_path: path, kind: input.kind,
      width: image.width, height: image.height, size_bytes: image.data.length, sha256: sha256(image.data),
      flagged: true, flag_reason: FLAG_REASON,
    })
    .select("id")
    .single();
  if (error || !data) {
    await deps.store.remove(path);
    return { ok: false, error: error?.code === "54000" ? "limit_reached" : "failed" };
  }
  return { ok: true, id: data.id as string, width: image.width, height: image.height };
}

/**
 * Pixelates regions into the stored file itself (a new file replaces the old one) and clears the flag as "blurred".
 * The row is updated before the old file is removed, so a failure never leaves a row pointing at nothing.
 */
export async function blurDemoAsset(
  deps: { admin: SupabaseClient; store: UploadStore; read: (path: string) => Promise<Uint8Array | null> },
  ctx: { workspaceId: string; demoId: string; assetId: string; userId: string },
  regions: Rect[],
): Promise<{ ok: true } | { ok: false; error: DemoAssetError }> {
  const { data: row } = await deps.admin
    .from("demo_assets").select("file_path").eq("id", ctx.assetId).eq("demo_id", ctx.demoId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!row) return { ok: false, error: "not_found" };
  const original = await deps.read(row.file_path as string);
  if (!original) return { ok: false, error: "failed" };
  let out;
  try {
    out = await pixelateRegions(original, regions);
  } catch {
    return { ok: false, error: "failed" };
  }
  const path = demoAssetPath(ctx.workspaceId, ctx.demoId);
  if (!(await deps.store.put(path, out.data, "image/webp"))) return { ok: false, error: "failed" };
  const { error } = await deps.admin
    .from("demo_assets")
    .update({ file_path: path, sha256: sha256(out.data), size_bytes: out.data.length, flagged: false, flag_reason: null, resolution: "blurred", resolved_at: new Date().toISOString(), resolved_by: ctx.userId })
    .eq("id", ctx.assetId);
  if (error) {
    await deps.store.remove(path);
    return { ok: false, error: "failed" };
  }
  await deps.store.remove(row.file_path as string);
  return { ok: true };
}

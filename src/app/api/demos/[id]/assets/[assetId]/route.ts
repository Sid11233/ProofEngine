import "server-only";
import { z } from "zod";
import { blurDemoAsset } from "@/lib/demos/assets";
import { getDemoStore, readDemoFile } from "@/lib/demos/assets-server";
import { guardDemoEdit, json } from "@/lib/demos/guard";
import { rectSchema } from "@/lib/demos/schema";
import { readLimited } from "@/lib/security/body";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// PATCH { how: "acknowledged" }            the owner confirms the image shows nothing private
// PATCH { how: "blurred", regions: [...] } pixelate those regions into the file, which counts as resolved
// DELETE                                    remove the image
const bodySchema = z.discriminatedUnion("how", [
  z.object({ how: z.literal("acknowledged") }).strict(),
  z.object({ how: z.literal("blurred"), regions: z.array(rectSchema).min(1).max(20) }).strict(),
]);

type Ctx = { params: Promise<{ id: string; assetId: string }> };

async function authorise(request: Request, ctx: Ctx) {
  const { id, assetId } = await ctx.params;
  const guard = await guardDemoEdit(request, id);
  if (guard instanceof Response) return guard;
  if (!z.uuid().safeParse(assetId).success) return json({ error: "not_found" }, 404);
  // Row level security: only this workspace's asset rows are visible.
  const { data } = await (await createClient()).from("demo_assets").select("id").eq("id", assetId).eq("demo_id", guard.demoId).maybeSingle();
  return data ? { guard, assetId } : json({ error: "not_found" }, 404);
}

export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await authorise(request, ctx);
  if (auth instanceof Response) return auth;
  const raw = await readLimited(request, 16 * 1024);
  if (raw === null) return json({ error: "too_large" }, 413);
  let parsed;
  try {
    parsed = bodySchema.safeParse(JSON.parse(new TextDecoder().decode(raw)));
  } catch {
    return json({ error: "invalid" }, 400);
  }
  if (!parsed.success) return json({ error: "invalid" }, 400);

  if (parsed.data.how === "acknowledged") {
    const { error } = await (await createClient()).rpc("resolve_demo_asset", { asset: auth.assetId, how: "acknowledged" });
    return error ? json({ error: "failed" }, 400) : json({ ok: true });
  }
  const result = await blurDemoAsset(
    { admin: createAdminClient(), store: getDemoStore(), read: readDemoFile },
    { workspaceId: auth.guard.workspaceId, demoId: auth.guard.demoId, assetId: auth.assetId, userId: auth.guard.userId },
    parsed.data.regions,
  );
  return result.ok ? json({ ok: true }) : json({ error: result.error }, result.error === "not_found" ? 404 : 500);
}

export async function DELETE(request: Request, ctx: Ctx) {
  const auth = await authorise(request, ctx);
  if (auth instanceof Response) return auth;
  const admin = createAdminClient();
  const { data: row } = await admin.from("demo_assets").select("file_path").eq("id", auth.assetId).eq("demo_id", auth.guard.demoId).maybeSingle();
  if (!row) return json({ error: "not_found" }, 404);
  const { error } = await admin.from("demo_assets").delete().eq("id", auth.assetId);
  if (error) return json({ error: "failed" }, 500);
  await getDemoStore().remove(row.file_path as string);
  return json({ ok: true });
}

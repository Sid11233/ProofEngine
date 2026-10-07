import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseStore, type UploadStore } from "@/lib/uploads/store";
import { DEMO_BUCKET } from "./assets";

// Service role access to the private demo-assets bucket and the asset rows. Used only by the demo asset routes,
// and only after they have authenticated the user and checked role and demo ownership (or, for public delivery,
// confirmed the demo is published right now).

let store: UploadStore | undefined;
export const getDemoStore = (): UploadStore => (store ??= createSupabaseStore(createAdminClient(), DEMO_BUCKET));

export async function readDemoFile(path: string): Promise<Uint8Array | null> {
  const { data, error } = await createAdminClient().storage.from(DEMO_BUCKET).download(path);
  return error || !data ? null : new Uint8Array(await data.arrayBuffer());
}

/** The file path of an image that a visitor may see: it belongs to a demo that is published right now. */
export async function publicAssetPath(assetId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: asset } = await admin.from("demo_assets").select("file_path, demo_id").eq("id", assetId).maybeSingle();
  if (!asset) return null;
  const { data: demo } = await admin.from("demos").select("status").eq("id", asset.demo_id).maybeSingle();
  return demo?.status === "published" ? (asset.file_path as string) : null;
}

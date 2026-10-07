import { z } from "zod";
import { readDemoFile, publicAssetPath } from "@/lib/demos/assets-server";
import { getUser } from "@/lib/auth/session";
import { publicViewAllowed } from "@/lib/public/view-limit";
import { createClient } from "@/lib/supabase/server";

// Delivers one demo image. A signed-in member of the demo's workspace can fetch any of their images (the editor).
// Everyone else gets it only while the demo is published; otherwise the answer is the same 404 as for an unknown id.
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  if (!(await publicViewAllowed(request.headers))) return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  const { assetId } = await params;
  if (!z.uuid().safeParse(assetId).success) return notFound();

  let path: string | null = null;
  let isPrivate = false;
  if (await getUser()) {
    // Row level security limits this to the caller's own workspaces.
    const { data } = await (await createClient()).from("demo_assets").select("file_path").eq("id", assetId).maybeSingle();
    if (data) { path = data.file_path as string; isPrivate = true; }
  }
  path ??= await publicAssetPath(assetId);
  if (!path) return notFound();

  const bytes = await readDemoFile(path);
  if (!bytes) return notFound();
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": isPrivate ? "private, no-store" : "public, max-age=300",
    },
  });
}

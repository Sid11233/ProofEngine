import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { publishedAssetPath, readDemoFile } from "@/lib/demos/assets-server";
import { publicViewAllowed } from "@/lib/public/view-limit";

// A demo image for visitors: served only if it belongs to THIS published demo (workspace and slug in the URL).
const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ workspace: string; slug: string; assetId: string }> }) {
  if (!(await publicViewAllowed(request.headers))) return new NextResponse("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  const { workspace, slug, assetId } = await params;
  if (!z.uuid().safeParse(assetId).success) return notFound();
  const path = await publishedAssetPath(workspace, slug, assetId);
  const bytes = path ? await readDemoFile(path) : null;
  if (!bytes) return notFound();
  return new NextResponse(bytes as BodyInit, {
    headers: {
      "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
      "Referrer-Policy": "no-referrer", "Cache-Control": "public, max-age=0, s-maxage=60",
    },
  });
}

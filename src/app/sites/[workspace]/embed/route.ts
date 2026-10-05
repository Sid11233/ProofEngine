import { NextResponse } from "next/server";
import { brand } from "@/lib/brand";
import { listPublishedStudies } from "@/lib/public/load";
import { publicPageUrl } from "@/lib/public/host";
import { getClientIp } from "@/lib/security/client-ip";
import { publicEnv } from "@/lib/security/env.public";
import { sha256Hex } from "@/lib/security/hash";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { createPublicClient } from "@/lib/supabase/public";
import { embedCsp, renderWall } from "@/lib/wall/embed-html";

// The wall of proof: an iframe-able list of a workspace's published stories. It is off until an admin
// enables it (the public view only contains enabled widgets), it only ever frames into the sites the
// admin listed (CSP frame-ancestors), and it contains no scripts.

const limiter = createRateLimiter({ prefix: "wall:ip", limit: 120, windowSec: 60 });
const WORKSPACE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const LOCKED = "default-src 'none'; frame-ancestors 'none'";

const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Content-Security-Policy": LOCKED } });

export async function GET(request: Request, { params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  if (!WORKSPACE.test(workspace)) return notFound();
  if (!(await limiter.limit(sha256Hex(getClientIp(request.headers)))).success) {
    return new NextResponse("Too many requests", { status: 429, headers: { "Retry-After": "60", "Content-Security-Policy": LOCKED } });
  }

  const anon = createPublicClient();
  const { data: settings } = await anon.from("public_wall_settings").select("allowed_origins, layout, max_items").eq("workspace_slug", workspace).maybeSingle();
  if (!settings || !Array.isArray(settings.allowed_origins) || settings.allowed_origins.length === 0) return notFound();

  const list = await listPublishedStudies(anon, workspace, Number(settings.max_items) || 6);
  if (!list) return notFound();

  const domain = process.env.PUBLIC_SITES_DOMAIN ?? "";
  const secure = publicEnv.NEXT_PUBLIC_APP_URL.startsWith("https");
  const html = renderWall({
    workspaceName: list.workspaceName,
    layout: settings.layout === "list" ? "list" : "grid",
    items: list.items.map((i) => ({ headline: i.headline, clientName: i.clientName, href: publicPageUrl(domain, workspace, i.slug, secure) })),
    badge: list.showBadge ? { href: publicEnv.NEXT_PUBLIC_APP_URL, name: brand.name } : null,
  });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": embedCsp(settings.allowed_origins.map(String)),
      "Cache-Control": "public, max-age=0, s-maxage=60",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

import { NextResponse } from "next/server";
import { loadPublishedStudy } from "@/lib/public/load";
import { publicViewAllowed } from "@/lib/public/view-limit";
import { createPublicClient } from "@/lib/supabase/public";
import { signedLogoUrl } from "@/lib/uploads/server";

// The logo bucket is private. This hands out a short-lived link, and only for a page that is
// published right now (checked through the public view, so a taken-down page has no logo either).
export async function GET(request: Request, { params }: { params: Promise<{ workspace: string; slug: string }> }) {
  if (!(await publicViewAllowed(request.headers))) return new NextResponse("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  const { workspace, slug } = await params;
  const study = await loadPublishedStudy(createPublicClient(), workspace, slug);
  const url = study ? await signedLogoUrl(study.logoPath, 120) : null;
  if (!url) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "public, max-age=60", "Referrer-Policy": "no-referrer" } });
}

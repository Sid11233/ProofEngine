import "server-only";
import { NextResponse } from "next/server";
import { publicEnv } from "@/lib/security/env.public";
import { serverEnv } from "@/lib/security/env.server";
import { securityTxt } from "@/lib/security/security-txt";

// Served at /.well-known/security.txt (see the rewrite in next.config.ts). 404 until SECURITY_CONTACT is set.
export function GET() {
  const contact = serverEnv.SECURITY_CONTACT;
  if (!contact) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(securityTxt({ contact, appUrl: publicEnv.NEXT_PUBLIC_APP_URL }), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

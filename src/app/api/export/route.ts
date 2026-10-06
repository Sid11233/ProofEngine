import "server-only";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { isAuthAttemptAllowed } from "@/lib/auth/rate-limits";
import { checkRecentAuth } from "@/lib/auth/recent-auth";
import { getUser } from "@/lib/auth/session";
import { buildExport } from "@/lib/privacy/export";
import { getClientIp } from "@/lib/security/client-ip";
import { publicEnv } from "@/lib/security/env.public";
import { isSameOrigin } from "@/lib/security/origin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

// The workspace owner's data export (a zip of JSON files). Owner only, recent sign-in, same-origin POST, 3 per
// hour. It reads through the owner's own client, so row-level security limits it to their workspace.

const no = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!isSameOrigin(request, publicEnv.NEXT_PUBLIC_APP_URL)) return no(403, "forbidden");
  const user = await getUser();
  if (!user) return no(401, "unauthorized");
  const workspace = await getCurrentWorkspace();
  if (!workspace || workspace.role !== "owner") return no(403, "forbidden");
  if (!(await isAuthAttemptAllowed("export", { ip: getClientIp(await headers()), subject: user.id }))) return no(429, "rate_limited");
  if (await checkRecentAuth()) return no(401, "reauth");

  try {
    const { zip } = await buildExport(await createClient(), workspace.id);
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(zip), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="workspace-export-${stamp}.zip"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return no(500, "export_failed");
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { isIpAttemptAllowed } from "@/lib/auth/rate-limits";
import { otpTypeSchema } from "@/lib/auth/schemas";
import { getClientIp } from "@/lib/security/client-ip";
import { safeNextPath } from "@/lib/auth/redirects";
import { publicEnv } from "@/lib/security/env.public";
import { createClient } from "@/lib/supabase/server";

// Email links that carry a token_hash (works across browsers, unlike PKCE codes).
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = otpTypeSchema.safeParse(searchParams.get("type"));
  const base = publicEnv.NEXT_PUBLIC_APP_URL;
  const fallback = type.success && type.data === "recovery" ? "/reset-password" : "/app/dashboard";
  const next = safeNextPath(searchParams.get("next"), fallback);

  if (!(await isIpAttemptAllowed("callback", getClientIp(request.headers)))) {
    return NextResponse.redirect(new URL("/login?error=rate", base));
  }
  if (tokenHash && tokenHash.length <= 512 && type.success) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type: type.data, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, base));
  }
  return NextResponse.redirect(new URL("/login?error=auth", base));
}

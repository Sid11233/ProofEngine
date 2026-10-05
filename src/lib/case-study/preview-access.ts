import "server-only";
import { headers } from "next/headers";
import { getClientIp } from "@/lib/security/client-ip";
import { sha256Hex } from "@/lib/security/hash";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPreviewResolver, type PreviewResult } from "./preview-access-core";

let resolver: ReturnType<typeof createPreviewResolver> | undefined;

/** Token-authenticated: the only reason this file may use the service role. 30 requests per minute per IP, 60 per token. */
export async function resolvePreview(rawToken: string): Promise<PreviewResult> {
  resolver ??= createPreviewResolver({
    admin: createAdminClient(),
    ipLimiter: createRateLimiter({ prefix: "preview:ip", limit: 30, windowSec: 60 }),
    tokenLimiter: createRateLimiter({ prefix: "preview:token", limit: 60, windowSec: 60 }),
  });
  return resolver(rawToken, { ip: sha256Hex(getClientIp(await headers())) });
}

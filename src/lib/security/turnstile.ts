const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verifies a Cloudflare Turnstile token server-side. Fails closed: any network error,
 * non-200 or unexpected answer counts as "not human".
 */
export async function verifyTurnstile({
  secret,
  token,
  ip,
  fetchImpl = fetch,
}: {
  secret: string;
  token: string | undefined;
  ip?: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  if (!token || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const response = await fetchImpl(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: unknown };
    return result.success === true;
  } catch {
    return false;
  }
}

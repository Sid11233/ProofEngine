import { createHmac, timingSafeEqual } from "node:crypto";

// A stable unsubscribe token per request: `<request id>.<HMAC of the id>`. It must stay valid however many
// times the interview link is rotated by later reminders, and it is never stored, so it is derived from a
// server secret. It grants one thing only: "stop emailing me about this request".

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const mac = (secret: string, requestId: string) => createHmac("sha256", secret).update("unsubscribe:v1:").update(requestId).digest("base64url");

export const unsubscribeToken = (secret: string, requestId: string) => `${requestId}.${mac(secret, requestId)}`;

/** The request id when the token is genuine, otherwise null. Constant-time comparison. */
export function verifyUnsubscribeToken(secret: string, token: string): string | null {
  if (typeof token !== "string" || token.length > 100) return null;
  const [id, tag, extra] = token.split(".");
  if (extra !== undefined || !id || !tag || !UUID.test(id)) return null;
  const expected = Buffer.from(mac(secret, id));
  const given = Buffer.from(tag);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

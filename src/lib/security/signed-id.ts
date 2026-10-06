import { createHmac, timingSafeEqual } from "node:crypto";

// A stable, storage-free link token for one id: `<uuid>.<HMAC of label and id>`. Used for links that must
// keep working for as long as the thing exists (unsubscribe, "remove my story"), whatever else changes. It
// proves only that we issued the link for that id; the label keeps one kind of link from opening another.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const mac = (secret: string, label: string, id: string) => createHmac("sha256", secret).update(`${label}:`).update(id).digest("base64url");

export const signId = (secret: string, label: string, id: string) => `${id}.${mac(secret, label, id)}`;

/** The id when the token is genuine for this label, otherwise null. Constant-time comparison. */
export function verifySignedId(secret: string, label: string, token: string): string | null {
  if (typeof token !== "string" || token.length > 100) return null;
  const [id, tag, extra] = token.split(".");
  if (extra !== undefined || !id || !tag || !UUID.test(id)) return null;
  const expected = Buffer.from(mac(secret, label, id));
  const given = Buffer.from(tag);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

/** The shape of a genuine token, checked before anything else touches it. */
export const isPlausibleSignedToken = (value: string) => /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(value);

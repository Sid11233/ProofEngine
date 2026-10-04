import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Invite, preview, approval and interview links all use the same scheme: a random
// 32-byte token goes to the recipient, only its SHA-256 hash is stored. A leaked
// database therefore contains no usable links.

const TOKEN_BYTES = 32;
// 32 bytes in base64url is exactly 43 characters.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

/** Cheap shape check so malformed input never reaches the database. */
export function isWellFormedToken(raw: string): boolean {
  return TOKEN_PATTERN.test(raw);
}

/** Compares two hex digests without leaking where they first differ. */
export function constantTimeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

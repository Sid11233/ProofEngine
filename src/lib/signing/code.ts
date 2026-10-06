import { createHmac, randomInt } from "node:crypto";

/** A six digit code, from a cryptographic random source. */
export const generateCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** What is stored: a keyed hash bound to the link, never the code. */
export const hashCode = (secret: string, tokenHash: string, code: string) =>
  createHmac("sha256", secret).update(`signing-code:v1:${tokenHash}:${code}`).digest("hex");

export const isWellFormedCode = (value: unknown): value is string => typeof value === "string" && /^\d{6}$/.test(value);

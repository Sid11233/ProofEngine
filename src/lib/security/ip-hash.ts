import { createHmac } from "node:crypto";

/**
 * Keyed hash of a client IP, stored with an approval as evidence without keeping the address.
 * Keyed so a leaked database cannot be reversed by hashing every IPv4 address.
 */
export const hashIp = (secret: string, ip: string) => createHmac("sha256", secret).update(ip, "utf8").digest("hex");

/** IP_HASH_SECRET when set, otherwise a key derived from the service role key (never the key itself). */
export const ipHashSecret = (env: { IP_HASH_SECRET?: string; SUPABASE_SERVICE_ROLE_KEY: string }) =>
  env.IP_HASH_SECRET ?? createHmac("sha256", env.SUPABASE_SERVICE_ROLE_KEY).update("proof-engine:ip-hash:v1").digest("hex");

/** Secret for unsubscribe tokens: IP_HASH_SECRET when set, otherwise a separate key derived from the service role key. */
export const unsubscribeSecret = (env: { IP_HASH_SECRET?: string; SUPABASE_SERVICE_ROLE_KEY: string }) =>
  createHmac("sha256", env.IP_HASH_SECRET ?? env.SUPABASE_SERVICE_ROLE_KEY).update("proof-engine:unsubscribe:v1").digest("hex");

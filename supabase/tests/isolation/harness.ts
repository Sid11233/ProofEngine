import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;

export interface LocalConfig {
  url: string;
  anonKey: string;
  serviceKey: string;
}

/**
 * Reads the local Supabase connection details. Refuses anything that is not a
 * local instance: this suite creates users and wipes rows, so it must never be
 * pointed at the dev or prod project.
 */
export function loadLocalConfig(): LocalConfig {
  let url = process.env.ISOLATION_SUPABASE_URL;
  let anonKey = process.env.ISOLATION_SUPABASE_ANON_KEY;
  let serviceKey = process.env.ISOLATION_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceKey) {
    const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const vars = new Map<string, string>();
    for (const line of out.split("\n")) {
      const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
      if (match) vars.set(match[1], match[2]);
    }
    url = vars.get("API_URL");
    anonKey = vars.get("ANON_KEY");
    serviceKey = vars.get("SERVICE_ROLE_KEY");
  }
  if (!url || !anonKey || !serviceKey) {
    throw new Error("Local Supabase is not running. Start it with `npx supabase start` first.");
  }
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Refusing to run isolation tests against non-local host "${host}".`);
  }
  return { url, anonKey, serviceKey };
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

export function makeClient(cfg: LocalConfig, key: "anon" | "service"): SupabaseClient {
  return createClient(cfg.url, key === "anon" ? cfg.anonKey : cfg.serviceKey, clientOptions);
}

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

export async function createTestUser(cfg: LocalConfig, admin: SupabaseClient, label: string): Promise<TestUser> {
  const email = `isolation-${label}-${randomBytes(4).toString("hex")}@example.test`;
  const password = randomBytes(24).toString("base64url");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    throw new Error(`could not create test user ${label}: ${created.error?.message}`);
  }
  const client = createClient(cfg.url, cfg.anonKey, clientOptions);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`could not sign in test user ${label}: ${signedIn.error.message}`);
  return { id: created.data.user.id, email, client };
}

export const hex64 = () => randomBytes(32).toString("hex");
export const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
export const slug = () => `iso-${randomUUID().slice(0, 8)}`;

/** Unwraps a seed query or fails loudly, naming what was being seeded. */
export async function must<T>(
  query: PromiseLike<{ data: T; error: { message: string } | null }>,
  what: string,
): Promise<NonNullable<T>> {
  const { data, error } = await query;
  if (error || data === null || data === undefined) {
    throw new Error(`seed "${what}" failed: ${error?.message ?? "no data"}`);
  }
  return data as NonNullable<T>;
}

/** True when a write was stopped: an error, or no row was affected. */
export function wasBlocked(result: { data: unknown; error: unknown }): boolean {
  if (result.error) return true;
  return Array.isArray(result.data) ? result.data.length === 0 : result.data === null;
}

/** Rows a read returned, treating an error (permission denied) as "nothing". */
export function rowsOf(result: { data: unknown; error: unknown }): Row[] {
  return Array.isArray(result.data) ? (result.data as Row[]) : [];
}

/**
 * A verified, web-consenting signature for the case study's current version, as the signing flow will
 * write it (service role). Publishing is refused without one.
 */
export async function signCurrent(admin: SupabaseClient, caseStudyId: string, opts: { social?: boolean } = {}): Promise<string> {
  const { data: cs } = await admin.from("case_studies").select("workspace_id, current_version").eq("id", caseStudyId).single();
  if (!cs) throw new Error("signCurrent: case study not found");
  const { data, error } = await admin
    .from("signatures")
    .insert({
      workspace_id: cs.workspace_id, case_study_id: caseStudyId, version: cs.current_version, signer_name: "Test Signer", signer_email: "signer@example.test",
      display_name_choice: "full", consent_text_version: "v1", esign_disclosure_accepted: true, consent_web: true, consent_social: opts.social === true,
      method: "typed", content_hash: randomBytes(32).toString("hex"), otp_verified_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`signCurrent: ${error?.message}`);
  return String(data.id);
}

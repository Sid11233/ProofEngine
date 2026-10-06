import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLocalConfig, makeClient, type LocalConfig } from "../supabase/tests/isolation/harness";

export const PORT = 3111;
export const BASE = `http://localhost:${PORT}`;

export interface Stack {
  cfg: LocalConfig;
  admin: SupabaseClient;
  server: ChildProcess;
  browser: Browser;
}

/** Starts the production build of the app against the LOCAL Supabase, plus a browser. */
export async function startStack(extraEnv: Record<string, string> = {}): Promise<Stack> {
  const cfg = loadLocalConfig();
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: cfg.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: cfg.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: cfg.serviceKey,
      NEXT_PUBLIC_APP_URL: BASE,
      // The tests give each browser its own client IP through this header.
      TRUST_PROXY_HEADERS: "1",
      ...extraEnv,
    },
    stdio: "ignore",
    detached: true,
  });

  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE, { redirect: "manual" });
      if (res.status < 500) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
    if (i === 59) throw new Error("app did not start; run `npm run build` first");
  }

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  return { cfg, admin: makeClient(cfg, "service"), server, browser };
}

export async function stopStack(stack: Stack | undefined) {
  if (!stack) return;
  await stack.browser.close();
  try {
    if (stack.server.pid) process.kill(-stack.server.pid, "SIGTERM");
  } catch {
    stack.server.kill("SIGTERM");
  }
  // The next test file starts its own server on the same port with its own environment. If this one is
  // still listening, that file would silently talk to it, so wait until the port is really free.
  for (let i = 0; i < 40; i++) {
    const alive = await fetch(BASE, { redirect: "manual", signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
    if (!alive) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

let ipCounter = 0;

/**
 * A page that appears to come from its own client IP. Rate limits are keyed by IP,
 * so tests must not share one bucket. (On Vercel the platform overwrites this
 * header; the app trusts it only because it is deployed behind such a proxy.)
 */
export async function newPage(stack: Stack): Promise<Page> {
  ipCounter += 1;
  const context = await stack.browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${(Date.now() + ipCounter) % 250 + 1}` },
  });
  return context.newPage();
}

/** A confirmed user, with a workspace of their own unless `withWorkspace` is false. */
export async function createUser(admin: SupabaseClient, label: string, { withWorkspace = true } = {}) {
  const email = `e2e-${label}-${randomBytes(4).toString("hex")}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  if (withWorkspace) {
    const { data: ws, error: wsError } = await admin.from("workspaces").insert({ name: `E2E ${label}`, type: "agency" }).select("id").single();
    if (wsError || !ws) throw new Error(`workspace failed: ${wsError?.message}`);
    const { error: memberError } = await admin.from("workspace_members").insert({ workspace_id: ws.id, user_id: data.user.id, role: "owner" });
    if (memberError) throw new Error(`membership failed: ${memberError.message}`);
  }
  return { id: data.user.id, email, password };
}

/** Collects console errors, notably Content-Security-Policy violations. */
export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || /content security policy/i.test(msg.text())) problems.push(msg.text());
  });
  page.on("pageerror", (err) => problems.push(String(err)));
  return problems;
}

/** Waits for a form's status message to appear, then returns its text. */
export async function statusText(page: Page): Promise<string> {
  const status = page.locator("[role=status]:not(:empty)");
  await status.waitFor();
  return status.innerText();
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 6238 time-based one-time password, as an authenticator app would compute it. */
export function totp(secretBase32: string, stepOffset = 0, now = Date.now()): string {
  let bits = "";
  for (const char of secretBase32.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    bits += BASE32.indexOf(char).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)?.map((byte) => parseInt(byte, 2)) ?? []);
  const counter = Math.floor(now / 30_000) + stepOffset;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

/** A verified, web-consenting signature for a study's current version (publishing is refused without one). */
export async function signStudy(admin: SupabaseClient, studyId: string): Promise<void> {
  const { data: cs } = await admin.from("case_studies").select("workspace_id, current_version").eq("id", studyId).single();
  if (!cs) throw new Error("signStudy: case study not found");
  const { error } = await admin.from("signatures").insert({
    workspace_id: cs.workspace_id, case_study_id: studyId, version: cs.current_version, signer_name: "E2E Signer", signer_email: "signer@example.test",
    display_name_choice: "full", consent_text_version: "v1", esign_disclosure_accepted: true, consent_web: true, consent_social: false, consent_media: false,
    method: "typed", content_hash: randomBytes(32).toString("hex"), otp_verified_at: new Date().toISOString(),
  });
  if (error) throw new Error(`signStudy: ${error.message}`);
}

/**
 * Opens a signing link as the client who has already entered the emailed code: the test cannot read the email, so it
 * writes the verified challenge and gives the browser the matching session cookie, exactly as a correct code would.
 */
export async function openVerifiedSigningLink(page: Page, stack: Stack, rawToken: string): Promise<void> {
  const { createHash } = await import("node:crypto");
  const sha = (v: string) => createHash("sha256").update(v).digest("hex");
  const { data: token } = await stack.admin.from("case_study_approval_tokens").select("id, case_study_id, version").eq("token_hash", sha(rawToken)).single();
  const session = randomBytes(32).toString("base64url");
  const { error } = await stack.admin.from("signing_challenges").insert({
    case_study_id: token?.case_study_id, version: token?.version, token_id: token?.id, code_hash: randomBytes(32).toString("hex"),
    expires_at: new Date(Date.now() + 600_000).toISOString(), attempts: 1, consumed_at: new Date().toISOString(), session_hash: sha(session),
  });
  if (error) throw new Error(`openVerifiedSigningLink: ${error.message}`);
  await page.context().addCookies([{ name: `pe_sign_${rawToken.slice(0, 12)}`, value: session, url: BASE, httpOnly: true, sameSite: "Strict" }]);
}

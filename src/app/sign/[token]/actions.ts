"use server";

import "server-only";
import { after } from "next/server";
import { z } from "zod";
import { pushToWorkspace } from "@/lib/push/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken } from "@/lib/security/tokens";
import { readSession, requestContext, signingService, writeSession } from "@/lib/signing/access";

export interface SignState {
  ok: boolean;
  /** What went wrong, in words the client can act on. */
  message?: string;
  reason?: string;
  done?: "signed" | "changes" | "declined" | "code_sent" | "verified";
  removalUrl?: string | null;
}

const MESSAGES: Record<string, string> = {
  not_found: "This link is no longer valid. It may have been used already, or the case study was changed. Please ask for a new link.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  bad_input: "Please check what you entered.",
  unverified: "That code did not work. Check the latest email, or ask for a new code.",
  version_changed: "This version has changed. Please reload the page; if the link no longer works, ask for a new one.",
  too_many_codes: "You asked for too many codes. Please wait an hour, or ask the team to send a new link.",
  failed: "Something went wrong. Please try again.",
};

const tokenSchema = z.string().min(20).max(100);
const fail = (reason: string): SignState => ({ ok: false, reason, message: MESSAGES[reason] ?? MESSAGES.failed });

export async function sendCodeAction(token: string): Promise<SignState> {
  if (!tokenSchema.safeParse(token).success) return fail("not_found");
  const result = await signingService().sendCode(token, await requestContext());
  return result.ok ? { ok: true, done: "code_sent" } : fail(result.reason);
}

export async function verifyCodeAction(token: string, input: unknown): Promise<SignState> {
  if (!tokenSchema.safeParse(token).success) return fail("not_found");
  const result = await signingService().verifyCode(token, input, await requestContext());
  if (!result.ok) return fail(result.reason);
  await writeSession(token, result.session);
  return { ok: true, done: "verified" };
}

export async function signAction(token: string, input: unknown): Promise<SignState> {
  if (!tokenSchema.safeParse(token).success) return fail("not_found");
  const result = await signingService().sign(token, await readSession(token), input, await requestContext());
  if (!result.ok) return fail(result.reason);
  // A generic "a client approved a case study" push, only to members who switched it on.
  const hash = hashToken(token);
  after(async () => {
    const { data } = await createAdminClient().from("case_study_approval_tokens").select("workspace_id").eq("token_hash", hash).maybeSingle();
    if (typeof data?.workspace_id === "string") await pushToWorkspace(data.workspace_id, "approval_received").catch(() => undefined);
  });
  return { ok: true, done: "signed" };
}

export async function requestChangesAction(token: string, input: unknown): Promise<SignState> {
  if (!tokenSchema.safeParse(token).success) return fail("not_found");
  const result = await signingService().requestChanges(token, await readSession(token), input, await requestContext());
  return result.ok ? { ok: true, done: "changes" } : fail(result.reason);
}

export async function declineAction(token: string): Promise<SignState> {
  if (!tokenSchema.safeParse(token).success) return fail("not_found");
  const result = await signingService().decline(token, await readSession(token), await requestContext());
  return result.ok ? { ok: true, done: "declined", removalUrl: result.removalUrl } : fail(result.reason);
}

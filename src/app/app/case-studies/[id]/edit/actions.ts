"use server";

import "server-only";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { publishStudy, requestApproval, unpublishStudy } from "@/lib/case-study/approval-service";
import { prepareEdit } from "@/lib/case-study/edit";
import { isValidSlug } from "@/lib/case-study/slug";
import { getEmailSender } from "@/lib/email/resend";
import { themeSchema } from "@/lib/case-study/theme";
import { getClientIp } from "@/lib/security/client-ip";
import { publicEnv } from "@/lib/security/env.public";
import { serverEnv } from "@/lib/security/env.server";
import { removalSecret } from "@/lib/security/ip-hash";
import { removalToken } from "@/lib/security/removal";
import { generateToken } from "@/lib/security/tokens";
import { createClient } from "@/lib/supabase/server";
import { classify } from "@/lib/team/service";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import type { FieldErrors } from "@/lib/validation/form";

export interface AutosaveResult {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
  version?: number;
  /** True when this save also started a new version (at most once a minute for a draft). */
  versioned?: boolean;
  editedClaims?: number;
}

const idSchema = z.uuid();
const NO_PERMISSION = { ok: false, message: "You do not have permission to do that." } as const;

async function authorise() {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace || workspace.role === "viewer") return null;
  const ip = getClientIp(await headers());
  if (!(await isAuthAttemptAllowed("case-study-edit", { ip, subject: user.id }))) return "throttled" as const;
  return { user, workspace };
}

/** Called every few seconds while the owner types. Validates everything again on the server. */
export async function autosaveContentAction(id: string, content: unknown): Promise<AutosaveResult> {
  const auth = await authorise();
  if (auth === "throttled") return { ok: false, message: RATE_LIMITED_MESSAGE };
  if (!auth) return NO_PERMISSION;
  if (!idSchema.safeParse(id).success) return { ok: false, message: "That case study was not found." };

  const supabase = await createClient();
  const prepared = await prepareEdit(supabase, id, content);
  if (!prepared.ok) return { ok: false, message: prepared.message, fieldErrors: prepared.fieldErrors };

  const { data, error } = await supabase.rpc("autosave_case_study", { study: id, new_content: prepared.content, edited_claims: prepared.edited });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) {
    return { ok: false, message: error?.code === "22023" ? "This case study cannot be edited right now (it may be published, or the logo is not valid)." : "We could not save. We will try again." };
  }
  if (row.versioned) revalidatePath(`/app/case-studies/${id}/review`);
  return { ok: true, version: Number(row.version), versioned: row.versioned === true, editedClaims: prepared.edited.length };
}

/** Theme choices (colour, fonts, radius, spacing, mode). Anything outside the allowlists is rejected. */
export async function saveThemeAction(id: string, theme: unknown): Promise<AutosaveResult> {
  const auth = await authorise();
  if (auth === "throttled") return { ok: false, message: RATE_LIMITED_MESSAGE };
  if (!auth) return NO_PERMISSION;
  const parsedId = idSchema.safeParse(id);
  const parsedTheme = themeSchema.safeParse(theme);
  if (!parsedId.success || !parsedTheme.success) return { ok: false, message: "That theme is not valid." };

  // Row-level security keeps this to editors of the study's workspace and to unpublished studies.
  const { data, error } = await (await createClient()).from("case_studies").update({ theme_settings: parsedTheme.data }).eq("id", parsedId.data).select("id");
  if (error || !data?.length) return { ok: false, message: "We could not save the theme." };
  return { ok: true };
}

export interface PreviewActionResult {
  ok: boolean;
  message?: string;
  /** The link, shown once. Only its hash is stored. */
  link?: string;
  previewId?: string;
}

export async function createPreviewLinkAction(studyId: string): Promise<PreviewActionResult> {
  const auth = await authorise();
  if (auth === "throttled") return { ok: false, message: RATE_LIMITED_MESSAGE };
  if (!auth) return NO_PERMISSION;
  const id = idSchema.safeParse(studyId);
  if (!id.success) return { ok: false, message: "That case study was not found." };

  const token = generateToken();
  const { data: previewId, error } = await (await createClient()).rpc("create_preview_link", { study: id.data, hash: token.hash });
  if (error || typeof previewId !== "string") {
    if (!error) return { ok: false, message: "We could not create the link." };
    const kind = classify(error);
    return { ok: false, message: kind === "limit" ? "You have 10 active preview links. Revoke one first." : kind === "invalid" ? "Published case studies do not need a preview link." : "We could not create the link." };
  }
  revalidatePath(`/app/case-studies/${id.data}/edit`);
  return { ok: true, previewId, link: new URL(`/preview/${token.raw}`, publicEnv.NEXT_PUBLIC_APP_URL).toString() };
}

export async function revokePreviewLinkAction(studyId: string, previewId: string): Promise<PreviewActionResult> {
  const auth = await authorise();
  if (auth === "throttled") return { ok: false, message: RATE_LIMITED_MESSAGE };
  if (!auth) return NO_PERMISSION;
  const ids = z.object({ studyId: idSchema, previewId: idSchema }).strict().safeParse({ studyId, previewId });
  if (!ids.success) return { ok: false, message: "That link was not found." };

  const { error } = await (await createClient()).rpc("revoke_preview_link", { preview: ids.data.previewId });
  if (error) return { ok: false, message: "We could not revoke the link." };
  revalidatePath(`/app/case-studies/${ids.data.studyId}/edit`);
  return { ok: true, message: "Link revoked. It stops working immediately." };
}

export interface LifecycleResult {
  ok: boolean;
  message?: string;
  /** The approval link, shown once so the owner can copy it if the email did not go out. */
  link?: string;
  slug?: string;
}

const publishInput = z.object({ studyId: idSchema, slug: z.string().max(60).nullable() }).strict();

/** Editor and above: send the client the exact current version to approve. */
export async function requestApprovalAction(studyId: string): Promise<LifecycleResult> {
  const auth = await authorise();
  if (auth === "throttled") return { ok: false, message: RATE_LIMITED_MESSAGE };
  if (!auth) return NO_PERMISSION;
  const id = idSchema.safeParse(studyId);
  if (!id.success) return { ok: false, message: "That case study was not found." };

  const result = await requestApproval(await createClient(), id.data, { appUrl: publicEnv.NEXT_PUBLIC_APP_URL, workspaceName: auth.workspace.name, sender: getEmailSender(), removalUrl: (studyId) => new URL(`/remove/${removalToken(removalSecret(serverEnv), studyId)}`, publicEnv.NEXT_PUBLIC_APP_URL).toString() });
  if (!result.ok) return result;
  revalidatePath(`/app/case-studies/${id.data}/edit`);
  return { ok: true, link: result.link, message: result.emailSent ? "We emailed your client." : "Email is not set up, so copy the link below and send it to your client yourself." };
}

/** Admin and above (the database checks too). Every publish rule is enforced by a trigger. */
export async function publishAction(studyId: string, slug: string | null, headline: string): Promise<LifecycleResult> {
  const auth = await authorise();
  if (auth === "throttled") return { ok: false, message: RATE_LIMITED_MESSAGE };
  if (!auth || (auth.workspace.role !== "admin" && auth.workspace.role !== "owner")) return NO_PERMISSION;
  const input = publishInput.safeParse({ studyId, slug: slug?.trim() ? slug.trim().toLowerCase() : null });
  if (!input.success || (input.data.slug !== null && !isValidSlug(input.data.slug))) return { ok: false, message: "That page address is not valid. Use lowercase letters, numbers and single hyphens." };

  const result = await publishStudy(await createClient(), input.data.studyId, input.data.slug, headline.slice(0, 200));
  if (result.ok) revalidatePath(`/app/case-studies/${input.data.studyId}/edit`);
  return result.ok ? { ok: true, slug: result.slug } : result;
}

export async function unpublishAction(studyId: string): Promise<LifecycleResult> {
  const auth = await authorise();
  if (auth === "throttled") return { ok: false, message: RATE_LIMITED_MESSAGE };
  if (!auth || (auth.workspace.role !== "admin" && auth.workspace.role !== "owner")) return NO_PERMISSION;
  const id = idSchema.safeParse(studyId);
  if (!id.success) return { ok: false, message: "That case study was not found." };
  const result = await unpublishStudy(await createClient(), id.data);
  if (result.ok) revalidatePath(`/app/case-studies/${id.data}/edit`);
  return result;
}

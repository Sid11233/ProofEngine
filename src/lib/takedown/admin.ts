import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { parsePlatformAdmins } from "@/lib/security/env-schema";
import { serverEnv } from "@/lib/security/env.server";

/** Signed in, email verified and on the PLATFORM_ADMIN_EMAILS list. Anyone else gets a plain 404. */
export async function requirePlatformAdmin() {
  const user = await requireUser();
  const admins = parsePlatformAdmins(serverEnv.PLATFORM_ADMIN_EMAILS) ?? [];
  if (!user.email || !user.email_confirmed_at || !admins.includes(user.email.toLowerCase())) notFound();
  return user;
}

export const isPlatformAdminEmail = (email: string | undefined | null) =>
  Boolean(email) && (parsePlatformAdmins(serverEnv.PLATFORM_ADMIN_EMAILS) ?? []).includes(String(email).toLowerCase());

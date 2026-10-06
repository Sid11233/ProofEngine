"use server";

import { redirect } from "next/navigation";
import { performRemoval } from "@/lib/privacy/removal-access";
import { isPlausibleSignedToken } from "@/lib/security/signed-id";

/** Posted from the confirm page: opening the link alone (an email scanner, a preview) deletes nothing. */
export async function removeStoryAction(token: string): Promise<void> {
  const result = isPlausibleSignedToken(token) ? await performRemoval(token) : "invalid";
  redirect(`/remove/${encodeURIComponent(token.slice(0, 100))}?result=${result}`);
}

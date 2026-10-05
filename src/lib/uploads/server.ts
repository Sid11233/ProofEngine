import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseStore, type UploadStore } from "./store";

let store: UploadStore | undefined;

/**
 * Private-bucket access for files the server has already validated and authorised.
 * It uses the service role only for Storage (no policy lets clients write there), and only
 * after the calling route has checked the user's workspace and role.
 */
export const getUploadStore = (): UploadStore => (store ??= createSupabaseStore(createAdminClient()));

/** A short-lived link to one stored file, or null when there is no logo. */
export async function signedLogoUrl(path: string | undefined | null, seconds = 300): Promise<string | null> {
  if (!path) return null;
  return getUploadStore().signedUrl(path, seconds);
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { referrerHost, type PageEvent } from "./schemas";

/** One insert through record_page_event(): type, page, hostname-only referrer and a timestamp. Nothing else exists to store. */
export async function recordPageEvent(admin: SupabaseClient, workspace: string, slug: string, event: PageEvent): Promise<boolean> {
  const { data, error } = await admin.rpc("record_page_event", {
    ws_slug: workspace,
    study_slug: slug,
    event_type: event.type,
    ref_host: event.type === "view" ? referrerHost(event.referrer) : null,
  });
  return !error && data === true;
}

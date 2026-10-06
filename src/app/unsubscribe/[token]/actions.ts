"use server";

import { redirect } from "next/navigation";
import { confirmUnsubscribe } from "@/lib/reminders/unsubscribe-access";
import { isPlausibleUnsubscribeToken, unsubscribePath } from "@/lib/reminders/unsubscribe-path";

/** Posted from the confirm page, so an email scanner that merely opens the link cannot unsubscribe anyone. */
export async function unsubscribeAction(token: string): Promise<void> {
  if (!isPlausibleUnsubscribeToken(token)) redirect(unsubscribePath(token, "invalid"));
  redirect(unsubscribePath(token, await confirmUnsubscribe(token)));
}

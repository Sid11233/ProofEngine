"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { confirmUnsubscribe } from "@/lib/reminders/unsubscribe-access";

/** Posted from the confirm page, so an email scanner that merely opens the link cannot unsubscribe anyone. */
export async function unsubscribeAction(token: string): Promise<void> {
  if (!z.string().min(40).max(100).safeParse(token).success) redirect(`/unsubscribe/${encodeURIComponent(token.slice(0, 100))}?result=invalid`);
  const result = await confirmUnsubscribe(token);
  redirect(`/unsubscribe/${token}?result=${result}`);
}

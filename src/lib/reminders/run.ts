import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSender } from "@/lib/email/types";
import { generateToken } from "@/lib/security/tokens";
import { unsubscribeToken } from "@/lib/security/unsubscribe";

// The reminder job. Every rule (day 3 and 7, at most 2, active and unanswered only, do-not-contact, the
// per-workspace daily limit) is enforced in the database by auto_remind_candidates / auto_remind_request;
// this code only picks the due requests, sends the email and gives the reminder back if sending failed.

export interface ReminderContext {
  admin: SupabaseClient;
  sender: EmailSender | null;
  appUrl: string;
  unsubscribeSecret: string;
  batch?: number;
}

export interface ReminderSummary {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  emailConfigured: boolean;
}

export function reminderEmail({ clientName, workspaceName, link, unsubscribeLink, number, purpose = "review" }: { clientName: string; workspaceName: string; link: string; unsubscribeLink: string; number: 1 | 2; purpose?: string }) {
  const first = clientName.trim().split(/\s+/)[0] || "there";
  const onboarding = purpose === "onboarding";
  return {
    subject: onboarding ? (number === 1 ? `Reminder: a few quick questions for ${workspaceName}` : `Last reminder from ${workspaceName}`) : number === 1 ? `Reminder: ${workspaceName} would like to hear from you` : `Last reminder from ${workspaceName}`,
    text: [
      `Hi ${first},`,
      "",
      onboarding
        ? `A quick reminder: ${workspaceName} has a few onboarding questions for you. Your answers go to them only; nothing is published.`
        : number === 1
        ? `A quick reminder: ${workspaceName} would love to hear about your experience. It takes about 3 minutes, and nothing is published without your approval.`
        : `This is the last reminder. If you have 3 minutes, ${workspaceName} would still love to hear about your experience. Nothing is published without your approval.`,
      "",
      link,
      "",
      "This link replaces the one in our earlier email and works for 30 days.",
      "",
      `Do not want these emails? Stop them here: ${unsubscribeLink}`,
    ].join("\n"),
  };
}

export async function runReminders(ctx: ReminderContext): Promise<ReminderSummary> {
  const summary: ReminderSummary = { considered: 0, sent: 0, skipped: 0, failed: 0, emailConfigured: ctx.sender !== null };
  // Without a way to send, rotating links would strand clients on dead links, so do nothing at all.
  if (!ctx.sender) return summary;

  const { data: candidates } = await ctx.admin.rpc("auto_remind_candidates", { batch: ctx.batch ?? 50 });
  const ids = ((candidates ?? []) as Array<{ request_id: string }>).map((c) => String(c.request_id));
  summary.considered = ids.length;

  for (const id of ids) {
    const { data: before } = await ctx.admin.from("proof_requests").select("client_name, client_email, workspace_id, reminder_count, last_reminder_at, purpose").eq("id", id).maybeSingle();
    if (!before) {
      summary.skipped += 1;
      continue;
    }
    const token = generateToken();
    const { data: rotated, error } = await ctx.admin.rpc("auto_remind_request", { request_id: id, new_hash: token.hash });
    if (error) {
      summary.failed += 1;
      continue;
    }
    if (rotated !== true) {
      summary.skipped += 1;
      continue;
    }

    const { data: ws } = await ctx.admin.from("workspaces").select("name").eq("id", before.workspace_id).maybeSingle();
    const message = reminderEmail({
      clientName: String(before.client_name),
      workspaceName: String(ws?.name ?? "us"),
      link: new URL(`/i/${token.raw}`, ctx.appUrl).toString(),
      unsubscribeLink: new URL(`/unsubscribe/${unsubscribeToken(ctx.unsubscribeSecret, id)}`, ctx.appUrl).toString(),
      number: Number(before.reminder_count) === 0 ? 1 : 2,
      purpose: String(before.purpose),
    });
    const ok = await ctx.sender.send({ to: String(before.client_email), ...message });
    if (ok) {
      summary.sent += 1;
    } else {
      summary.failed += 1;
      await ctx.admin.rpc("auto_remind_revert", { request_id: id, previous_last: before.last_reminder_at ?? null });
    }
  }
  return summary;
}

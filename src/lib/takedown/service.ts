import type { SupabaseClient } from "@supabase/supabase-js";
import { workspaceAlertAddresses } from "@/lib/email/recipients";
import type { EmailSender } from "@/lib/email/types";
import type { ReportInput } from "./schemas";

// Takedown reports. Core logic over injected dependencies so it can be tested against the real database
// without the server-only wrappers. A report never removes a page by itself; it tells the people who can.

export type ReportOutcome = { ok: true; id: string; notified: number } | { ok: false; reason: "not_found" | "limit" | "failed" };

export interface ReportContext {
  admin: SupabaseClient;
  sender: EmailSender | null;
  platformAdmins: string[];
  appUrl: string;
}

export function reportEmail({ headline, workspaceName, reason, contact, reviewUrl }: { headline: string; workspaceName: string; reason: string; contact: string; reviewUrl: string }) {
  return {
    subject: `Someone reported a page on ${workspaceName}`,
    text: [
      `A visitor reported the published case study "${headline}".`,
      "",
      "What they wrote:",
      reason,
      "",
      `They can be reached at: ${contact}`,
      "",
      "Nothing was removed automatically. If the page should come down, unpublish it now:",
      reviewUrl,
    ].join("\n"),
  };
}

export async function submitReport(ctx: ReportContext, input: ReportInput, ipHash: string): Promise<ReportOutcome> {
  const { data: id, error } = await ctx.admin.rpc("create_takedown_request", {
    ws_slug: input.workspace,
    study_slug: input.slug,
    report_reason: input.reason,
    email: input.email,
    ip: ipHash,
  });
  if (error || typeof id !== "string") {
    if (error?.code === "P0002") return { ok: false, reason: "not_found" };
    // A repeat report from the same contact (unique index) or a page with 20 open reports: no new row.
    if (error?.code === "54000" || error?.code === "23505") return { ok: false, reason: "limit" };
    return { ok: false, reason: "failed" };
  }

  let notified = 0;
  if (ctx.sender) {
    const { data: study } = await ctx.admin
      .from("takedown_requests")
      .select("workspace_id, case_study_id")
      .eq("id", id)
      .maybeSingle();
    if (study) {
      const [{ data: cs }, { data: ws }] = await Promise.all([
        ctx.admin.from("case_studies").select("content").eq("id", study.case_study_id).maybeSingle(),
        ctx.admin.from("workspaces").select("name").eq("id", study.workspace_id).maybeSingle(),
      ]);
      const headline = typeof (cs?.content as { headline?: unknown } | null)?.headline === "string" ? String((cs?.content as { headline: string }).headline) : "a case study";
      const message = reportEmail({
        headline,
        workspaceName: String(ws?.name ?? "your workspace"),
        reason: input.reason,
        contact: input.email,
        reviewUrl: new URL(`/app/case-studies/${study.case_study_id}/edit`, ctx.appUrl).toString(),
      });
      const recipients = [...new Set([...(await workspaceAlertAddresses(ctx.admin, String(study.workspace_id))), ...ctx.platformAdmins])];
      for (const to of recipients) if (await ctx.sender.send({ to, ...message })) notified += 1;
    }
  }
  return { ok: true, id, notified };
}

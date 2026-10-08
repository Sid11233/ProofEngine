import type { SupabaseClient } from "@supabase/supabase-js";
import { workspaceAlertAddresses } from "@/lib/email/recipients";
import type { EmailSender } from "@/lib/email/types";

// Two emails when an interview finishes. Both are plain text.
//   * The client gets a thank-you at the address ON FILE for the request. The address typed on the last screen is
//     never mailed (anyone holding the link could type someone else's address), only shown to the business.
//   * The workspace owners and admins get a short alert with a link. No answers, names or contact details travel by email.

export function thankYouEmail({ firstName, workspaceName, unsubscribe, purpose = "review" }: { firstName: string; workspaceName: string; unsubscribe: string; purpose?: "review" | "onboarding" }) {
  if (purpose === "onboarding") {
    return {
      subject: `Thank you from ${workspaceName}`,
      text: [
        `Hi ${firstName},`,
        "",
        `Thank you for answering ${workspaceName}'s questions. Your answers have been sent to them, and nothing is published.`,
        "",
        "You do not need to do anything now. They will be in touch about the next steps.",
        "",
        `If you would rather not get emails about this request: ${unsubscribe}`,
      ].join("\n"),
    };
  }
  return {
    subject: `Thank you from ${workspaceName}`,
    text: [
      `Hi ${firstName},`,
      "",
      `Thank you for sharing your experience with ${workspaceName}. Your answers have been sent to them.`,
      "",
      "What happens next: they may write a short case study from your answers. Nothing is published until you have seen and approved the exact wording, and you will get a separate email with a link to do that.",
      "",
      "You do not need to do anything now.",
      "",
      `If you would rather not get emails about this request: ${unsubscribe}`,
    ].join("\n"),
  };
}

export function ownerAlertEmail({ workspaceName, rating, link, purpose = "review" }: { workspaceName: string; rating?: number; link: string; purpose?: "review" | "onboarding" }) {
  if (purpose === "onboarding") {
    return {
      subject: `A new client finished onboarding for ${workspaceName}`,
      text: ["A client finished answering your onboarding questions.", "", "Open the request to read their answers:", link].join("\n"),
    };
  }
  return {
    subject: `A client finished their interview for ${workspaceName}`,
    text: [
      "One of your clients finished their interview.",
      rating ? `They rated the experience of working with you ${rating} out of 5.` : "They did not leave a rating.",
      "",
      "Open the request to read their answers and any feedback or contact details they left:",
      link,
    ].join("\n"),
  };
}

export async function notifyInterviewFinished(
  ctx: { admin: SupabaseClient; sender: EmailSender | null; appUrl: string; unsubscribeUrl: (requestId: string) => string },
  access: { requestId: string; workspaceId: string },
  rating?: number,
  purpose: "review" | "onboarding" = "review",
): Promise<void> {
  if (!ctx.sender) return;
  const [{ data: request }, { data: workspace }, recipients] = await Promise.all([
    ctx.admin.from("proof_requests").select("client_name, client_email").eq("id", access.requestId).eq("workspace_id", access.workspaceId).maybeSingle(),
    ctx.admin.from("workspaces").select("name").eq("id", access.workspaceId).maybeSingle(),
    workspaceAlertAddresses(ctx.admin, access.workspaceId),
  ]);
  const workspaceName = String(workspace?.name ?? "your workspace");
  if (request?.client_email) {
    const first = String(request.client_name ?? "").trim().split(/\s+/)[0] || "there";
    await ctx.sender.send({ to: String(request.client_email), ...thankYouEmail({ firstName: first, workspaceName, unsubscribe: ctx.unsubscribeUrl(access.requestId), purpose }) });
  }
  const alert = ownerAlertEmail({ workspaceName, rating, purpose, link: new URL(`/app/requests/${access.requestId}`, ctx.appUrl).toString() });
  for (const to of recipients) await ctx.sender.send({ to, ...alert });
}

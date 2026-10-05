import { notFound } from "next/navigation";
import Link from "next/link";
import { GenerateButton } from "@/components/case-study/generate-button";
import { RequestActions } from "@/components/requests/request-actions";
import { requestIdSchema } from "@/lib/requests/schemas";
import { getRequest } from "@/lib/requests/service";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { regenerateLinkAction, revokeRequestAction, sendInviteAction, sendReminderAction } from "../actions";
import { pageTitle } from "@/lib/brand";

export const metadata = { title: pageTitle("Request") };

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!requestIdSchema.safeParse(id).success) notFound();

  // RLS scopes this to the caller's workspaces, so another tenant's id is simply "not found".
  const request = await getRequest(await createClient(), id);
  if (!request) notFound();
  const workspace = await getCurrentWorkspace();

  // A finished interview can be turned into a case study (once).
  const supabase = await createClient();
  const { data: interview } = await supabase.from("interviews").select("id, status").eq("request_id", request.id).maybeSingle();
  const { data: existing } = interview
    ? await supabase.from("case_studies").select("id").eq("interview_id", interview.id).maybeSingle()
    : { data: null };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{request.clientName}</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{request.clientEmail}</p>
      </div>
      <dl className="divide-y divide-neutral-200 rounded-md border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
        {[
          ["Status", request.status],
          ["Interview style", request.flowType],
          ["Project", request.projectType ?? "Not set"],
          ["Link expires", request.expiresAt.slice(0, 10)],
          ["Reminders sent", `${request.reminderCount} of 3`],
        ].map(([term, value]) => (
          <div key={term} className="flex gap-4 px-3 py-2">
            <dt className="w-32 shrink-0 text-neutral-600 dark:text-neutral-400">{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {interview?.status === "completed" && (
        <section aria-labelledby="cs-heading" className="space-y-3 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 id="cs-heading" className="font-semibold">Case study</h2>
          {existing ? (
            <Link href={`/app/case-studies/${existing.id}/review`} className="inline-flex min-h-11 items-center underline underline-offset-2">Open the case study</Link>
          ) : workspace?.role !== "viewer" ? (
            <GenerateButton interviewId={String(interview.id)} />
          ) : (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">Only editors and above can generate a case study.</p>
          )}
        </section>
      )}
      <RequestActions
        requestId={request.id}
        status={request.status}
        canManage={workspace?.role !== "viewer"}
        actions={{ send: sendInviteAction, remind: sendReminderAction, regenerate: regenerateLinkAction, revoke: revokeRequestAction }}
      />
    </div>
  );
}

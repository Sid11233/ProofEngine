import { notFound } from "next/navigation";
import Link from "next/link";
import { GenerateButton } from "@/components/case-study/generate-button";
import { DeleteInterviewButton } from "@/components/requests/delete-interview-button";
import { RequestActions } from "@/components/requests/request-actions";
import { requestIdSchema } from "@/lib/requests/schemas";
import { getRequest } from "@/lib/requests/service";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { deleteInterviewAction, regenerateLinkAction, revokeRequestAction, sendInviteAction, sendReminderAction } from "../actions";
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

  const onboarding = request.purpose === "onboarding";
  // An onboarding interview's answers are read here, as the conversation (plain text). Row level security scopes this to members.
  const { data: transcript } = onboarding && interview
    ? await supabase.from("interview_messages").select("id, role, content").eq("interview_id", interview.id).order("created_at").order("id")
    : { data: null };
  const { data: closing } = !onboarding && interview
    ? await supabase.from("interview_closing").select("rating, comment, contact_email, contact_phone, company, job_title").eq("interview_id", interview.id).maybeSingle()
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
          [onboarding ? "Type" : "Interview style", onboarding ? "Client onboarding" : request.flowType],
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
      {closing && (
        <section aria-labelledby="closing-heading" className="space-y-2 rounded-md border border-neutral-200 p-4 text-sm dark:border-neutral-800">
          <h2 id="closing-heading" className="font-semibold">Feedback and details from the client</h2>
          {closing.rating ? <p>Rated working with you <strong>{Number(closing.rating)} out of 5</strong>.</p> : null}
          {/* Plain text: the client typed these; pre-wrap keeps line breaks and nothing is read as markup. */}
          {closing.comment ? <p className="whitespace-pre-wrap rounded bg-neutral-100 p-3 dark:bg-neutral-900" data-testid="closing-comment">{String(closing.comment)}</p> : null}
          <dl className="space-y-1">
            {([["Company", closing.company], ["Role", closing.job_title], ["Email", closing.contact_email], ["Phone", closing.contact_phone]] as const).filter(([, v]) => v).map(([term, value]) => (
              <div key={term} className="flex gap-3"><dt className="w-20 shrink-0 text-neutral-600 dark:text-neutral-400">{term}</dt><dd className="break-all">{String(value)}</dd></div>
            ))}
          </dl>
        </section>
      )}
      {onboarding && (
        <section aria-labelledby="answers-heading" className="space-y-3 rounded-md border border-neutral-200 p-4 text-sm dark:border-neutral-800">
          <h2 id="answers-heading" className="font-semibold">Onboarding answers</h2>
          {!transcript?.length ? <p className="text-neutral-600 dark:text-neutral-400">Nothing yet. The conversation appears here as the client answers.</p> : (
            <ol className="space-y-2">
              {transcript.map((m) => (
                <li key={String(m.id)} className={m.role === "client" ? "rounded bg-neutral-100 p-3 dark:bg-neutral-900" : "px-1 text-neutral-600 dark:text-neutral-400"}>
                  <span className="mb-1 block text-xs font-medium">{m.role === "client" ? "Client" : "Assistant"}</span>
                  {/* Plain text: the client typed it; pre-wrap keeps line breaks and nothing is read as markup. */}
                  <span className="whitespace-pre-wrap break-words" data-testid={m.role === "client" ? "onboarding-answer" : undefined}>{String(m.content)}</span>
                </li>
              ))}
            </ol>
          )}
          {request.clientId ? <p><Link href={`/app/clients/${request.clientId}`} className="underline underline-offset-2">Open the client record</Link></p> : null}
        </section>
      )}
      {!onboarding && interview?.status === "completed" && (
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
      {(workspace?.role === "owner" || workspace?.role === "admin") && (
        <section aria-labelledby="privacy-heading" className="space-y-2 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 id="privacy-heading" className="font-semibold">Privacy</h2>
          {interview ? <p className="text-sm text-neutral-600 dark:text-neutral-400">If your client asks, you can delete everything they said in this interview.</p> : null}
          <DeleteInterviewButton interviewId={interview ? String(interview.id) : null} remove={deleteInterviewAction} />
        </section>
      )}
    </div>
  );
}

import { notFound } from "next/navigation";
import { RequestActions } from "@/components/requests/request-actions";
import { requestIdSchema } from "@/lib/requests/schemas";
import { getRequest } from "@/lib/requests/service";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { regenerateLinkAction, revokeRequestAction, sendInviteAction, sendReminderAction } from "../actions";

export const metadata = { title: "Request | Proof Engine" };

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!requestIdSchema.safeParse(id).success) notFound();

  // RLS scopes this to the caller's workspaces, so another tenant's id is simply "not found".
  const request = await getRequest(await createClient(), id);
  if (!request) notFound();
  const workspace = await getCurrentWorkspace();

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
      <RequestActions
        requestId={request.id}
        status={request.status}
        canManage={workspace?.role !== "viewer"}
        actions={{ send: sendInviteAction, remind: sendReminderAction, regenerate: regenerateLinkAction, revoke: revokeRequestAction }}
      />
    </div>
  );
}

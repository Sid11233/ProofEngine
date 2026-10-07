import { Illustration } from "@/components/illustrations/illustration";
import { ContentFade } from "@/components/motion/content-fade";
import { ReminderTip } from "@/components/requests/reminder-tip";
import { RequestList } from "@/components/requests/request-list";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { listRequests } from "@/lib/requests/service";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { setProjectTypeAction } from "../actions";

export const metadata = { title: pageTitle("Requests") };

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default async function RequestsPage() {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  const items = await listRequests(await createClient());
  const canCreate = workspace?.role !== "viewer";
  const completed = items.filter((i) => i.status === "completed").length;
  const subtitle = items.length === 0 ? "Send a client a short AI interview." : completed === items.length ? `${items.length} request${items.length === 1 ? "" : "s"}, all completed.` : `${items.length} request${items.length === 1 ? "" : "s"}, ${completed} completed.`;

  return (
    <ContentFade className="space-y-6">
      <PageHeader title="Requests" subtitle={subtitle} action={canCreate ? <ButtonLink href="/app/requests/new">New request</ButtonLink> : undefined} />
      {items.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <Illustration id="RQ-1" decorative className="w-56" />
          <div>
            <h2 className="text-lg font-semibold">No requests yet</h2>
            <p className="mt-1 text-sm text-muted">Create one to send a client an interview link.</p>
          </div>
        </Card>
      ) : (
        <>
          <RequestList rows={items.map((i) => ({ id: i.id, clientName: i.clientName, projectType: i.projectType, status: i.status, date: shortDate(i.createdAt) }))} canEdit={canCreate} saveProjectType={setProjectTypeAction} />
          <ReminderTip />
        </>
      )}
    </ContentFade>
  );
}

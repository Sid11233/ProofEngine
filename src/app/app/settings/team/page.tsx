import { redirect } from "next/navigation";
import { TeamManager } from "@/components/settings/team-manager";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listPendingInvites, listTeam } from "@/lib/team/service";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { changeRoleAction, inviteMemberAction, removeMemberAction, revokeInviteAction } from "./actions";
import { pageTitle } from "@/lib/brand";

import { ContentFade } from "@/components/motion/content-fade";
import { PageHeader } from "@/components/ui/page-header";
import { Illustration } from "@/components/illustrations/illustration";
export const metadata = { title: pageTitle("Team") };

export default async function TeamPage() {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");

  const supabase = await createClient();
  const isAdmin = workspace.role === "owner" || workspace.role === "admin";
  const [teammates, pending] = await Promise.all([
    listTeam(supabase, workspace.id),
    isAdmin ? listPendingInvites(supabase) : Promise.resolve([]),
  ]);

  return (
    <ContentFade className="max-w-3xl space-y-6">
      <PageHeader title="Team" subtitle="Who can work in this workspace, and what they can do." art={<Illustration id="TM-1" decorative />} />
      <TeamManager
        viewerRole={workspace.role}
        members={teammates.map((m) => ({
          userId: m.userId,
          label: m.fullName || m.email || "Unknown",
          email: m.fullName ? m.email : null,
          role: m.role,
          isYou: m.userId === user.id,
        }))}
        invites={pending.map((i) => ({ id: i.id, email: i.email, role: i.role, expires: i.expiresAt.slice(0, 10) }))}
        actions={{
          invite: inviteMemberAction,
          revoke: revokeInviteAction,
          changeRole: changeRoleAction,
          remove: removeMemberAction,
        }}
      />
    </ContentFade>
  );
}

import { redirect } from "next/navigation";
import { TeamManager } from "@/components/settings/team-manager";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listPendingInvites, listTeam } from "@/lib/team/service";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { changeRoleAction, inviteMemberAction, removeMemberAction, revokeInviteAction } from "./actions";

export const metadata = { title: "Team | Proof Engine" };

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
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Team</h1>
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
    </div>
  );
}

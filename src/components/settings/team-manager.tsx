"use client";

import { useActionState, useState, useTransition } from "react";
import { ReauthPrompt } from "@/components/auth/reauth-prompt";
import { FormMessage, SubmitButton, TextField } from "@/components/auth/form-parts";
import type { TeamActionResult } from "@/app/app/settings/team/actions";

type Role = "owner" | "admin" | "editor" | "viewer";

export interface TeamMemberView {
  userId: string;
  label: string;
  email: string | null;
  role: Role;
  isYou: boolean;
}

export interface InviteView {
  id: string;
  email: string;
  role: string;
  expires: string;
}

interface Props {
  viewerRole: Role;
  members: TeamMemberView[];
  invites: InviteView[];
  actions: {
    invite: (previous: TeamActionResult, formData: FormData) => Promise<TeamActionResult>;
    revoke: (inviteId: string) => Promise<TeamActionResult>;
    changeRole: (userId: string, role: string) => Promise<TeamActionResult>;
    remove: (userId: string) => Promise<TeamActionResult>;
  };
}

const selectClass =
  "min-h-11 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-base outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 dark:border-neutral-700";
const buttonClass =
  "inline-flex min-h-11 items-center rounded-md px-3 text-sm underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 disabled:opacity-60";

export function TeamManager({ viewerRole, members, invites, actions }: Props) {
  const isAdmin = viewerRole === "owner" || viewerRole === "admin";
  const isOwner = viewerRole === "owner";
  const [inviteState, inviteAction] = useActionState(actions.invite, { ok: false } as TeamActionResult);
  const [status, setStatus] = useState<TeamActionResult>();
  const [pending, startTransition] = useTransition();
  const [retry, setRetry] = useState<{ needed: NonNullable<TeamActionResult["reauth"]>; run: () => void } | null>(null);

  function run(task: () => Promise<TeamActionResult>) {
    setStatus(undefined);
    startTransition(async () => {
      const result = await task();
      if (result.reauth) {
        setRetry({ needed: result.reauth, run: () => run(task) });
        return;
      }
      setRetry(null);
      setStatus(result);
    });
  }

  const roleOptions: Role[] = isOwner ? ["owner", "admin", "editor", "viewer"] : ["editor", "viewer"];

  return (
    <div className="space-y-10">
      <div aria-live="polite" role="status">
        {status?.message ? (
          <p className={status.ok ? "rounded-md border border-green-700/30 bg-green-50 px-3 py-2 text-sm text-green-900 dark:bg-green-950 dark:text-green-100" : "rounded-md border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"}>
            {status.message}
          </p>
        ) : null}
      </div>

      {retry && <ReauthPrompt needed={retry.needed} onDone={() => retry.run()} />}

      <section aria-labelledby="members-heading" className="space-y-3">
        <h2 id="members-heading" className="text-lg font-semibold">Members</h2>
        <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {members.map((member) => {
            // Admins cannot touch owners; nobody changes their own role.
            const canManage = isAdmin && !member.isYou && (isOwner || member.role !== "owner");
            return (
              <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {member.label}
                    {member.isYou ? <span className="ml-2 text-sm font-normal text-neutral-600 dark:text-neutral-400">(you)</span> : null}
                  </p>
                  {member.email ? <p className="truncate text-sm text-neutral-600 dark:text-neutral-400">{member.email}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  {canManage ? (
                    <>
                      <label className="sr-only" htmlFor={`role-${member.userId}`}>Role for {member.label}</label>
                      <select
                        id={`role-${member.userId}`}
                        className={selectClass}
                        value={member.role}
                        disabled={pending}
                        onChange={(event) => run(() => actions.changeRole(member.userId, event.target.value))}
                      >
                        {[...new Set([member.role, ...roleOptions])].map((role) => (
                          <option key={role} value={role} disabled={role === "owner" && !isOwner}>{role}</option>
                        ))}
                      </select>
                      <button type="button" className={buttonClass} disabled={pending} onClick={() => run(() => actions.remove(member.userId))}>
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="text-sm">{member.role}</span>
                  )}
                  {member.isYou && member.role !== "owner" && (
                    <button type="button" className={buttonClass} disabled={pending} onClick={() => run(() => actions.remove(member.userId))}>
                      Leave
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {isAdmin ? (
        <>
          <section aria-labelledby="invite-heading" className="space-y-3">
            <h2 id="invite-heading" className="text-lg font-semibold">Invite someone</h2>
            <form action={inviteAction} className="space-y-4" noValidate>
              <TextField label="Email" name="email" type="email" autoComplete="off" errors={inviteState.fieldErrors?.email} />
              <div className="space-y-1.5">
                <label htmlFor="invite-role" className="block text-sm font-medium">Role</label>
                <select id="invite-role" name="role" defaultValue="editor" className={selectClass}>
                  {isOwner && <option value="admin">admin</option>}
                  <option value="editor">editor</option>
                  <option value="viewer">viewer</option>
                </select>
              </div>
              <FormMessage state={inviteState} />
              {inviteState.inviteLink && (
                <div className="space-y-1 text-sm">
                  <p className="font-medium">Invite link (shown once)</p>
                  <input readOnly value={inviteState.inviteLink} aria-label="Invite link" onFocus={(event) => event.currentTarget.select()} className="block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 font-mono text-sm dark:border-neutral-700" />
                </div>
              )}
              <SubmitButton pendingLabel="Inviting...">Send invitation</SubmitButton>
            </form>
          </section>

          <section aria-labelledby="pending-heading" className="space-y-3">
            <h2 id="pending-heading" className="text-lg font-semibold">Pending invitations</h2>
            {invites.length === 0 ? (
              <p className="text-sm text-neutral-600 dark:text-neutral-400">No pending invitations.</p>
            ) : (
              <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
                {invites.map((invite) => (
                  <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{invite.email}</p>
                      <p className="text-sm text-neutral-600 dark:text-neutral-400">{invite.role} · expires {invite.expires}</p>
                    </div>
                    <button type="button" className={buttonClass} disabled={pending} onClick={() => run(() => actions.revoke(invite.id))}>
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Only admins and owners can invite people or change roles.</p>
      )}
    </div>
  );
}

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { previewInvite } from "@/lib/team/service";
import { signOutAction } from "@/app/(auth)/actions";
import { acceptInviteAction } from "./actions";

export const metadata = {
  title: "Join a workspace | Proof Engine",
  robots: { index: false, follow: false },
};

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const user = await requireUser();
  const invite = await previewInvite(await createClient(), token);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 px-4 py-10">
      <p className="text-center text-lg font-semibold tracking-tight">Proof Engine</p>
      <div className="space-y-4 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
        {error === "rate" && <p role="alert" className="text-sm text-red-800 dark:text-red-300">Too many attempts. Please wait a few minutes.</p>}
        {error === "invalid" && <p role="alert" className="text-sm text-red-800 dark:text-red-300">This invitation could not be accepted.</p>}
        {invite ? (
          <>
            <h1 className="text-xl font-semibold">Join {invite.workspaceName}</h1>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              You have been invited as <strong>{invite.role}</strong>.
            </p>
            <form action={acceptInviteAction.bind(null, token)}>
              <button type="submit" className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-base font-medium text-white outline-none hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 dark:bg-neutral-100 dark:text-neutral-900">
                Accept invitation
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">This invitation cannot be used</h1>
            {/* Same message for expired, used, revoked, unknown and addressed-to-someone-else. */}
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              It may have expired, already been used, or been sent to a different email address. You are signed in as{" "}
              <strong>{user.email}</strong>. Ask the person who invited you to send a new link, or sign in with the address it was sent to.
            </p>
            <form action={signOutAction}>
              <button type="submit" className="text-sm underline underline-offset-2">Sign out</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

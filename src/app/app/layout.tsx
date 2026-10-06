import Link from "next/link";
import { redirect } from "next/navigation";
import { MfaBanner } from "@/components/settings/mfa-banner";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { signOutAction } from "@/app/(auth)/actions";
import { BrandMark } from "@/components/brand-mark";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { SignOutButton } from "@/components/pwa/sign-out-button";
import { isPlatformAdminEmail } from "@/lib/takedown/admin";
import { cookies } from "next/headers";
import { MotionProvider } from "@/components/motion/motion-provider";
import { MOTION_COOKIE, parsePreference } from "@/lib/motion/preference";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Middleware already redirects anonymous visitors; this is the second lock.
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");

  // Owners hold the keys to the workspace, so nudge them towards two-factor.
  let showMfaBanner = false;
  if (workspace.role === "owner") {
    const supabase = await createClient();
    const { data: factors } = await supabase.auth.mfa.listFactors();
    showMfaBanner = !factors?.totp?.length;
  }

  const motionPreference = parsePreference((await cookies()).get(MOTION_COOKIE)?.value);

  return (
    <MotionProvider initialPreference={motionPreference}>
    <div className="min-h-dvh">
      <ServiceWorkerRegister />
      {workspace.deletionRequestedAt ? (
        <p role="alert" className="border-b border-red-700/30 bg-red-50 px-4 py-2 text-center text-sm text-red-950">
          This workspace is scheduled for deletion on {new Date(Date.parse(workspace.deletionRequestedAt) + 30 * 86_400_000).toISOString().slice(0, 10)}.{" "}
          <Link href="/app/settings/privacy" className="font-medium underline underline-offset-2">Review or cancel</Link>
        </p>
      ) : null}
      {showMfaBanner ? <MfaBanner /> : null}
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="min-w-0">
          <BrandMark />
          <span className="ml-3 truncate text-sm text-neutral-600 dark:text-neutral-400">{workspace.name}</span>
        </div>
        <form action={signOutAction} className="flex items-center gap-3 text-sm">
          <span className="hidden text-neutral-600 sm:inline dark:text-neutral-400">{user.email}</span>
          <InstallPrompt />
          <SignOutButton />
        </form>
      </header>
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-neutral-200 px-4 text-sm dark:border-neutral-800">
        {[
          ["/app/dashboard", "Dashboard"],
          ["/app/requests", "Requests"],
          ["/app/case-studies", "Case studies"],
          ["/app/referrals", "Referrals"],
          ["/app/finder", "Communities"],
          ["/app/settings/wall", "Wall of proof"],
          ["/app/settings/social", "Social links"],
          ["/app/settings/notifications", "Notifications"],
          ["/app/settings/team", "Team"],
          ["/app/billing", "Billing"],
          ["/app/settings/privacy", "Privacy"],
          ["/app/settings/motion", "Motion"],
          ["/app/settings/security", "Security"],
          ...(user.email_confirmed_at && isPlatformAdminEmail(user.email) ? [["/app/admin/takedowns", "Takedowns"]] : []),
        ].map(([href, label]) => (
          <Link key={href} href={href} className="inline-flex min-h-11 items-center px-3 hover:underline">
            {label}
          </Link>
        ))}
      </nav>
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
      <footer className="mx-auto flex max-w-7xl flex-wrap gap-x-4 px-4 pb-8 text-sm text-neutral-600 dark:text-neutral-400">
        <Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-2">Privacy policy</Link>
        <Link href="/terms" className="inline-flex min-h-11 items-center underline underline-offset-2">Terms</Link>
        <Link href="/subprocessors" className="inline-flex min-h-11 items-center underline underline-offset-2">Subprocessors</Link>
        <Link href="/dpa" className="inline-flex min-h-11 items-center underline underline-offset-2">DPA</Link>
      </footer>
    </div>
    </MotionProvider>
  );
}

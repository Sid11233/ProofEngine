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
import { AppNav } from "@/components/motion/app-nav";
import { BottomTabBar } from "@/components/motion/bottom-tab-bar";
import { MotionProvider } from "@/components/motion/motion-provider";
import { ToastProvider } from "@/components/motion/toast";
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

  const navItems = [
    { href: "/app/dashboard", label: "Dashboard" },
    { href: "/app/requests", label: "Requests" },
    { href: "/app/case-studies", label: "Case studies" },
    { href: "/app/referrals", label: "Referrals" },
    { href: "/app/finder", label: "Communities" },
    { href: "/app/settings/wall", label: "Wall of proof" },
    { href: "/app/settings/social", label: "Social links" },
    { href: "/app/settings/notifications", label: "Notifications" },
    { href: "/app/settings/team", label: "Team" },
    { href: "/app/billing", label: "Billing" },
    { href: "/app/settings/privacy", label: "Privacy" },
    { href: "/app/settings/motion", label: "Motion" },
    { href: "/app/settings/security", label: "Security" },
    ...(user.email_confirmed_at && isPlatformAdminEmail(user.email) ? [{ href: "/app/admin/takedowns", label: "Takedowns" }] : []),
  ];
  // Phones get the main places in a bottom bar; icons are 24 px, 2 px stroke, round caps (ILL-40 family).
  const tabItems = [
    { href: "/app/dashboard", label: "Home", icon: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" },
    { href: "/app/requests", label: "Requests", icon: "M4 6h16v12H4zM4 7l8 6 8-6" },
    { href: "/app/case-studies", label: "Studies", icon: "M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6" },
    { href: "/app/referrals", label: "Referrals", icon: "M6 12a2 2 0 100-.01M18 6a2 2 0 100-.01M18 18a2 2 0 100-.01M8 11l8-4M8 13l8 4" },
    { href: "/app/settings/notifications", label: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-1V5h-4v2l-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1v2h4v-2l2-1 2 1 2-4-2-1z" },
  ];

  return (
    <MotionProvider initialPreference={motionPreference}>
    <ToastProvider>
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
      <AppNav items={navItems} />
      <main className="mx-auto max-w-7xl px-4 py-8 pb-24 md:pb-8">{children}</main>
      <footer className="mx-auto flex max-w-7xl flex-wrap gap-x-4 px-4 pb-8 text-sm text-neutral-600 dark:text-neutral-400">
        <Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-2">Privacy policy</Link>
        <Link href="/terms" className="inline-flex min-h-11 items-center underline underline-offset-2">Terms</Link>
        <Link href="/subprocessors" className="inline-flex min-h-11 items-center underline underline-offset-2">Subprocessors</Link>
        <Link href="/dpa" className="inline-flex min-h-11 items-center underline underline-offset-2">DPA</Link>
      </footer>
      <BottomTabBar items={tabItems} />
    </div>
    </ToastProvider>
    </MotionProvider>
  );
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/(auth)/actions";
import { MotionProvider } from "@/components/motion/motion-provider";
import { NavigationLoader } from "@/components/motion/navigation-loader";
import { ToastProvider } from "@/components/motion/toast";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { SignOutButton } from "@/components/pwa/sign-out-button";
import { AppShell, type ShellNotice } from "@/components/shell/app-shell";
import { LegalFooter } from "@/components/ui/legal-footer";
import { requireUser } from "@/lib/auth/session";
import { MOTION_COOKIE, parsePreference } from "@/lib/motion/preference";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdminEmail } from "@/lib/takedown/admin";
import { getCurrentWorkspace } from "@/lib/workspace/current";

const DAY = 86_400_000;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Middleware already redirects anonymous visitors; this is the second lock.
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");

  // One slim notice under the top bar, the most important first.
  let notice: ShellNotice | null = null;
  if (workspace.deletionRequestedAt) {
    const on = new Date(Date.parse(workspace.deletionRequestedAt) + 30 * DAY).toISOString().slice(0, 10);
    notice = { id: `deletion-${on}`, tone: "danger", text: `This workspace is scheduled for deletion on ${on}.`, actionHref: "/app/settings/privacy", actionLabel: "Review or cancel" };
  } else if (workspace.role === "owner") {
    // Owners hold the keys to the workspace, so nudge them towards two-factor.
    const { data: factors } = await (await createClient()).auth.mfa.listFactors();
    if (!factors?.totp?.length) notice = { id: "mfa", tone: "warning", text: "Protect your workspace with two-factor authentication.", actionHref: "/app/settings/security", actionLabel: "Turn on" };
  }

  const jar = await cookies();
  const motionPreference = parsePreference(jar.get(MOTION_COOKIE)?.value);
  const initialCollapsed = jar.get("pe_sidebar")?.value === "collapsed";

  return (
    <MotionProvider initialPreference={motionPreference}>
      <ToastProvider>
        <ServiceWorkerRegister />
        <AppShell
          workspace={{ name: workspace.name, plan: workspace.plan }}
          user={{ email: user.email ?? "" }}
          isPlatformAdmin={Boolean(user.email_confirmed_at && isPlatformAdminEmail(user.email))}
          notice={notice}
          initialCollapsed={initialCollapsed}
          installSlot={<InstallPrompt />}
          signOutSlot={
            <form action={signOutAction}>
              <SignOutButton />
            </form>
          }
          footer={<LegalFooter />}
        >
          {children}
        </AppShell>
        <NavigationLoader />
      </ToastProvider>
    </MotionProvider>
  );
}

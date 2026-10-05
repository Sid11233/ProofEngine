import Link from "next/link";
import { redirect } from "next/navigation";
import { MfaBanner } from "@/components/settings/mfa-banner";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { signOutAction } from "@/app/(auth)/actions";
import { BrandMark } from "@/components/brand-mark";

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

  return (
    <div className="min-h-dvh">
      {showMfaBanner ? <MfaBanner /> : null}
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="min-w-0">
          <BrandMark />
          <span className="ml-3 truncate text-sm text-neutral-600 dark:text-neutral-400">{workspace.name}</span>
        </div>
        <form action={signOutAction} className="flex items-center gap-3 text-sm">
          <span className="hidden text-neutral-600 sm:inline dark:text-neutral-400">{user.email}</span>
          <button type="submit" className="min-h-11 rounded-md px-3 underline underline-offset-2">
            Sign out
          </button>
        </form>
      </header>
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-neutral-200 px-4 text-sm dark:border-neutral-800">
        {[
          ["/app/dashboard", "Dashboard"],
          ["/app/requests", "Requests"],
          ["/app/case-studies", "Case studies"],
          ["/app/settings/wall", "Wall of proof"],
          ["/app/settings/team", "Team"],
          ["/app/settings/security", "Security"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="inline-flex min-h-11 items-center px-3 hover:underline">
            {label}
          </Link>
        ))}
      </nav>
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}

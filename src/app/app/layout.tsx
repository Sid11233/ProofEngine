import { requireUser } from "@/lib/auth/session";
import { signOutAction } from "@/app/(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Middleware already redirects anonymous visitors; this is the second lock.
  const user = await requireUser();

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <span className="font-semibold tracking-tight">Proof Engine</span>
        <form action={signOutAction} className="flex items-center gap-3 text-sm">
          <span className="hidden text-neutral-600 sm:inline dark:text-neutral-400">{user.email}</span>
          <button type="submit" className="min-h-11 rounded-md px-3 underline underline-offset-2">
            Sign out
          </button>
        </form>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}

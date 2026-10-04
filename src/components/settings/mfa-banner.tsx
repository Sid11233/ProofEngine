import Link from "next/link";

export function MfaBanner() {
  return (
    <div role="note" className="border-b border-amber-700/30 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
      Protect your workspace: turn on{" "}
      <Link href="/app/settings/security" className="font-medium underline underline-offset-2">
        two-factor authentication
      </Link>
      .
    </div>
  );
}

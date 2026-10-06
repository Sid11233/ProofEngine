import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <p className="text-center text-lg"><BrandMark height={48} /></p>
        <div className="space-y-5 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">{children}</div>
        <p className="flex justify-center gap-4 text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-2">Privacy</Link>
          <Link href="/terms" className="inline-flex min-h-11 items-center underline underline-offset-2">Terms</Link>
        </p>
      </div>
    </main>
  );
}

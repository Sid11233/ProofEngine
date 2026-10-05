import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-3xl"><BrandMark /></h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        Send clients an AI interview link and publish case studies they have approved.
      </p>
      <div className="flex w-full flex-col gap-3 sm:flex-row">
        <Link
          href="/signup"
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-neutral-900 px-4 py-2 font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Create account
        </Link>
        <Link
          href="/login"
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-neutral-300 px-4 py-2 font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}

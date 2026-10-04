import Link from "next/link";
import { safeNextPath } from "@/lib/auth/redirects";
import { LoginForm } from "@/components/auth/auth-forms";
import { loginAction, signInWithGoogleAction } from "../actions";

export const metadata = { title: "Sign in | Proof Engine" };

const ERRORS: Record<string, string> = {
  auth: "That link is invalid or has expired. Please try again.",
  oauth: "We could not start Google sign-in. Please try again.",
  rate: "Too many attempts. Please wait a few minutes and try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const safeNext = next ? safeNextPath(next) : undefined;
  const errorMessage = error ? ERRORS[error] : undefined;

  return (
    <>
      <h1 className="text-xl font-semibold">Sign in</h1>
      {errorMessage ? (
        <p role="alert" className="rounded-md border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
          {errorMessage}
        </p>
      ) : null}
      <LoginForm action={loginAction} next={safeNext} />
      <form action={signInWithGoogleAction}>
        {safeNext ? <input type="hidden" name="next" value={safeNext} /> : null}
        <button
          type="submit"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-neutral-300 px-4 py-2 text-base font-medium outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-900 dark:border-neutral-700 dark:hover:bg-neutral-900 dark:focus-visible:ring-neutral-100"
        >
          Continue with Google
        </button>
      </form>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="underline underline-offset-2">
          Forgot password?
        </Link>
        <Link href={safeNext ? `/signup?next=${encodeURIComponent(safeNext)}` : "/signup"} className="underline underline-offset-2">
          Create an account
        </Link>
      </div>
    </>
  );
}

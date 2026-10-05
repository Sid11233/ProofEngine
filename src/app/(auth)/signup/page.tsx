import Link from "next/link";
import { safeNextPath } from "@/lib/auth/redirects";
import { SignupForm } from "@/components/auth/auth-forms";
import { signupAction } from "../actions";
import { pageTitle } from "@/lib/brand";

export const metadata = { title: pageTitle("Create account") };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next ? safeNextPath(next) : undefined;
  return (
    <>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <SignupForm action={signupAction} next={safeNext} />
      <p className="text-sm">
        Already have an account?{" "}
        <Link href={safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : "/login"} className="underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </>
  );
}

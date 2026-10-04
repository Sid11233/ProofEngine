import Link from "next/link";
import { SignupForm } from "@/components/auth/auth-forms";
import { signupAction } from "../actions";

export const metadata = { title: "Create account | Proof Engine" };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <SignupForm action={signupAction} />
      <p className="text-sm">
        Already have an account?{" "}
        <Link href="/login" className="underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </>
  );
}

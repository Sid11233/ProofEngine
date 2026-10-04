import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/auth-forms";
import { forgotPasswordAction } from "../actions";

export const metadata = { title: "Reset password | Proof Engine" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">Enter your email and we will send you a reset link.</p>
      <ForgotPasswordForm action={forgotPasswordAction} />
      <Link href="/login" className="text-sm underline underline-offset-2">
        Back to sign in
      </Link>
    </>
  );
}

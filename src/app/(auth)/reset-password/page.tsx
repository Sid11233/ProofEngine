import { ResetPasswordForm } from "@/components/auth/auth-forms";
import { requireUser } from "@/lib/auth/session";
import { resetPasswordAction } from "../actions";
import { pageTitle } from "@/lib/brand";

export const metadata = { title: pageTitle("Choose a new password") };

export default async function ResetPasswordPage() {
  // Reached from the emailed link, which signs the user in. No session means an expired link.
  await requireUser();
  return (
    <>
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <ResetPasswordForm action={resetPasswordAction} />
    </>
  );
}

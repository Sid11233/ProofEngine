import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { requireUser } from "@/lib/auth/session";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { createWorkspaceAction } from "./actions";
import { pageTitle } from "@/lib/brand";
import { BrandMark } from "@/components/brand-mark";

export const metadata = { title: pageTitle("Set up your workspace") };

export default async function OnboardingPage() {
  await requireUser();
  if (await getCurrentWorkspace()) redirect("/app/dashboard");

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-10">
      <p className="mb-6 text-center text-lg"><BrandMark /></p>
      <OnboardingWizard action={createWorkspaceAction} />
    </main>
  );
}

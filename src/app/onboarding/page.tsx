import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { requireUser } from "@/lib/auth/session";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { createWorkspaceAction } from "./actions";

export const metadata = { title: "Set up your workspace | Proof Engine" };

export default async function OnboardingPage() {
  await requireUser();
  if (await getCurrentWorkspace()) redirect("/app/dashboard");

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-10">
      <p className="mb-6 text-center text-lg font-semibold tracking-tight">Proof Engine</p>
      <OnboardingWizard action={createWorkspaceAction} />
    </main>
  );
}

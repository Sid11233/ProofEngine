import { redirect } from "next/navigation";
import { QuestionsEditor } from "@/components/onboarding/questions-editor";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { loadEffectiveFlow } from "@/lib/onboarding/flow";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { resetQuestionsAction, saveQuestionsAction } from "../actions";

export const metadata = { title: pageTitle("Onboarding questions") };

export default async function OnboardingQuestionsPage() {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");
  const flow = await loadEffectiveFlow(await createClient(), workspace.id, workspace.type === "saas" ? "saas" : "agency");
  const canEdit = workspace.role !== "viewer";

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Onboarding questions" subtitle="What your new clients are asked." action={<ButtonLink variant="secondary" href="/app/onboarding">Back</ButtonLink>} />
      {!flow ? <p className="text-sm text-muted">The standard questions could not be loaded.</p> : canEdit ? (
        <QuestionsEditor initial={flow.questions} custom={flow.custom} workspaceName={workspace.name} save={saveQuestionsAction} reset={resetQuestionsAction} />
      ) : (
        <ol className="list-decimal space-y-2 pl-5 text-sm">{flow.questions.map((q) => <li key={q.id}>{q.text}</li>)}</ol>
      )}
    </div>
  );
}

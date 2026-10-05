import { redirect } from "next/navigation";
import { NewRequestForm } from "@/components/requests/new-request-form";
import { requireUser } from "@/lib/auth/session";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { createRequestAction } from "../actions";
import { pageTitle } from "@/lib/brand";

export const metadata = { title: pageTitle("New request") };

export default async function NewRequestPage() {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");
  // Viewers cannot create; the action and the database enforce it too.
  if (workspace.role === "viewer") redirect("/app/requests");

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold">New request</h1>
      <NewRequestForm action={createRequestAction} defaultFlow={workspace.type} />
    </div>
  );
}

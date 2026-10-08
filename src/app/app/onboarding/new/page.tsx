import { redirect } from "next/navigation";
import { NewOnboardingForm } from "@/components/onboarding/new-onboarding-form";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { idSchema } from "@/lib/clients/schemas";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { createOnboardingAction } from "../actions";

export const metadata = { title: pageTitle("New onboarding") };

export default async function NewOnboardingPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");
  if (workspace.role === "viewer") redirect("/app/onboarding");

  const supabase = await createClient();
  const { data: clients } = await supabase.from("clients").select("id, name, contact_name, contact_email").order("name").limit(500);
  // A client chosen from the Clients page pre-fills the form; it is only a convenience, the server re-checks everything.
  const wanted = idSchema.safeParse((await searchParams).client);
  const chosen = wanted.success ? clients?.find((c) => c.id === wanted.data) : undefined;

  return (
    <div className="max-w-xl space-y-6">
      <PageHeader title="New onboarding" subtitle="The client gets a link to a short chat. Their answers come back to you." />
      <Card>
        <NewOnboardingForm
          action={createOnboardingAction}
          clients={(clients ?? []).map((c) => ({ id: String(c.id), name: String(c.name) }))}
          defaults={{ clientId: chosen ? String(chosen.id) : undefined, clientName: chosen?.contact_name ? String(chosen.contact_name) : chosen ? String(chosen.name) : undefined, clientEmail: chosen?.contact_email ? String(chosen.contact_email) : undefined }}
        />
      </Card>
    </div>
  );
}

import { redirect } from "next/navigation";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { loadDashboard } from "@/lib/dashboard/load";
import { aiMessageLimitFor } from "@/lib/limits";
import { limits } from "@/lib/limits.server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export const metadata = { title: pageTitle("Dashboard") };

// Every number is read through the signed-in user's own client (never the service role), so row-level
// security limits it to their workspace.
export default async function DashboardPage() {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");
  const data = await loadDashboard(await createClient(), workspace.id, { plan: workspace.plan, aiLimit: aiMessageLimitFor(workspace.plan, limits) });
  return <DashboardView data={data} workspaceName={workspace.name} plan={workspace.plan} />;
}

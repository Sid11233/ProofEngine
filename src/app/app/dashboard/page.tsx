import { getCurrentWorkspace } from "@/lib/workspace/current";
import { pageTitle } from "@/lib/brand";

export const metadata = { title: pageTitle("Dashboard") };

export default async function DashboardPage() {
  const workspace = await getCurrentWorkspace();
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        {workspace?.name} · {workspace?.role}
      </p>
    </div>
  );
}

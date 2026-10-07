import "server-only";
import { DemoReportList, type DemoReportView } from "@/components/admin/demo-report-list";
import { PageHeader } from "@/components/ui/page-header";
import { pageTitle } from "@/lib/brand";
import { publicEnv } from "@/lib/security/env.public";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/takedown/admin";
import { blockDemoAction, resolveDemoReportAction } from "./actions";

export const metadata = { title: pageTitle("Demo reports"), robots: { index: false, follow: false } };

// Platform operators only (PLATFORM_ADMIN_EMAILS); everyone else gets a 404. Uses the service role after that check,
// because reports span workspaces.
export default async function DemoReportsPage() {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const { data: reports } = await admin.from("demo_reports").select("id, demo_id, reason, contact_email, status, created_at").order("created_at", { ascending: false }).limit(100);
  const demoIds = [...new Set((reports ?? []).map((r) => String(r.demo_id)))];
  const { data: demos } = demoIds.length ? await admin.from("demos").select("id, title, status, slug, workspace_id").in("id", demoIds) : { data: [] };
  const workspaceIds = [...new Set((demos ?? []).map((d) => String(d.workspace_id)))];
  const { data: workspaces } = workspaceIds.length ? await admin.from("workspaces").select("id, name, subdomain_slug").in("id", workspaceIds) : { data: [] };
  const demoOf = new Map((demos ?? []).map((d) => [String(d.id), d]));
  const workspaceOf = new Map((workspaces ?? []).map((w) => [String(w.id), w]));
  const openCount = new Map<string, number>();
  for (const r of reports ?? []) if (r.status === "open") openCount.set(String(r.demo_id), (openCount.get(String(r.demo_id)) ?? 0) + 1);
  const domain = process.env.PUBLIC_SITES_DOMAIN;
  const scheme = publicEnv.NEXT_PUBLIC_APP_URL.startsWith("https") ? "https" : "http";

  const items: DemoReportView[] = (reports ?? []).map((r) => {
    const demo = demoOf.get(String(r.demo_id));
    const workspace = demo ? workspaceOf.get(String(demo.workspace_id)) : undefined;
    return {
      id: String(r.id), demoId: String(r.demo_id), demoTitle: String(demo?.title ?? "(deleted)"), demoStatus: String(demo?.status ?? ""),
      workspaceName: String(workspace?.name ?? ""),
      publicUrl: domain && workspace?.subdomain_slug && demo?.slug && demo.status === "published" ? `${scheme}://${workspace.subdomain_slug}.${domain}/demo/${demo.slug}` : null,
      reason: String(r.reason), contact: String(r.contact_email ?? ""), status: String(r.status), created: String(r.created_at).slice(0, 10),
      openForDemo: openCount.get(String(r.demo_id)) ?? 0,
    };
  });

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Demo reports" subtitle="Reports never remove a demo on their own. Blocking takes a demo offline for everyone and stops its workspace from publishing it again." />
      <DemoReportList items={items} actions={{ block: blockDemoAction, resolve: resolveDemoReportAction }} />
    </div>
  );
}

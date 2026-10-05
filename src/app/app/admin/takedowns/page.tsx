import { TakedownList, type TakedownView } from "@/components/admin/takedown-list";
import { pageTitle } from "@/lib/brand";
import { publicPageUrl } from "@/lib/public/host";
import { publicEnv } from "@/lib/security/env.public";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/takedown/admin";
import { resolveAction, setDisabledAction } from "./actions";

export const metadata = { title: pageTitle("Takedown reports"), robots: { index: false, follow: false } };

// Platform operators only (PLATFORM_ADMIN_EMAILS); everyone else gets a 404. Uses the service role after
// that check, because reports span workspaces.
export default async function TakedownsPage() {
  await requirePlatformAdmin();
  const admin = createAdminClient();

  const { data: reports } = await admin
    .from("takedown_requests")
    .select("id, case_study_id, workspace_id, reason, contact_email, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  const studyIds = [...new Set((reports ?? []).map((r) => String(r.case_study_id)))];
  const workspaceIds = [...new Set((reports ?? []).map((r) => String(r.workspace_id)))];
  const [{ data: studies }, { data: workspaces }] = await Promise.all([
    studyIds.length ? admin.from("case_studies").select("id, content, slug, disabled_at").in("id", studyIds) : { data: [] },
    workspaceIds.length ? admin.from("workspaces").select("id, name, subdomain_slug").in("id", workspaceIds) : { data: [] },
  ]);
  const studyOf = new Map((studies ?? []).map((s) => [String(s.id), s]));
  const workspaceOf = new Map((workspaces ?? []).map((w) => [String(w.id), w]));
  const domain = process.env.PUBLIC_SITES_DOMAIN;
  const secure = publicEnv.NEXT_PUBLIC_APP_URL.startsWith("https");

  const items: TakedownView[] = (reports ?? []).map((r) => {
    const study = studyOf.get(String(r.case_study_id));
    const workspace = workspaceOf.get(String(r.workspace_id));
    const headline = (study?.content as { headline?: unknown } | undefined)?.headline;
    return {
      id: String(r.id),
      studyId: String(r.case_study_id),
      workspaceName: String(workspace?.name ?? ""),
      headline: typeof headline === "string" ? headline : "(untitled)",
      publicUrl: domain && workspace?.subdomain_slug && study?.slug ? publicPageUrl(domain, String(workspace.subdomain_slug), String(study.slug), secure) : null,
      reason: String(r.reason),
      contact: String(r.contact_email),
      status: String(r.status),
      created: String(r.created_at).slice(0, 10),
      disabled: study?.disabled_at != null,
    };
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Takedown reports</h1>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">Reports never remove a page on their own. Disabling a page takes it offline for everyone and stops its workspace from publishing it again.</p>
      </div>
      <TakedownList items={items} actions={{ setDisabled: setDisabledAction, resolve: resolveAction }} />
    </div>
  );
}

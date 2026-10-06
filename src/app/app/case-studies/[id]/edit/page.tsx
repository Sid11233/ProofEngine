import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CaseStudyEditor } from "@/components/case-study/case-study-editor";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { loadCaseStudy } from "@/lib/case-study/load";
import { explainPublishBlockers } from "@/lib/case-study/publish-check";
import { templateAllowed as templateAllowedFor, templateAllowedInDatabase } from "@/lib/billing/entitlements";
import { defaultTemplate, loadEntitledTemplateIds, loadTemplates } from "@/lib/templates/load";
import { effectiveTheme } from "@/lib/templates/model";
import { createClient } from "@/lib/supabase/server";
import { signedLogoUrl } from "@/lib/uploads/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { acceptRefinementAction, autosaveContentAction, createPreviewLinkAction, publishAction, requestApprovalAction, refineTextAction, restoreOriginalAction, revokePreviewLinkAction, saveThemeAction, unpublishAction } from "./actions";

export const metadata = { title: pageTitle("Edit case study") };

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [study, workspace, templates] = await Promise.all([loadCaseStudy(supabase, id), getCurrentWorkspace(), loadTemplates(supabase)]);
  if (!study || !workspace) notFound();

  const template = templates.find((t) => t.id === study.templateId) ?? defaultTemplate(templates);
  if (!template) notFound();

  const entitled = await loadEntitledTemplateIds(supabase, study.workspaceId);
  const allowed = templateAllowedFor({ tier: template.tier, plan: workspace.plan, entitled: entitled.has(template.id) });

  // For the "why can't I publish" list. The database publish trigger (Phase 6.2) is what enforces it.
  const { data: approvals } = await supabase.from("approvals").select("id").eq("case_study_id", study.id).eq("version", study.version).limit(1);
  const blockers = explainPublishBlockers({
    status: study.status,
    templateAllowed: await templateAllowedInDatabase(supabase, study.workspaceId, template.id),
    approvedCurrentVersion: (approvals ?? []).length > 0,
    allClaimsConfirmed: study.claims.length > 0 && study.claims.every((c) => c.confirmed),
  });

  const { data: previewRows } = await supabase
    .from("case_study_previews")
    .select("id, expires_at")
    .eq("case_study_id", study.id)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  const { data: feedbackRows } = await supabase
    .from("case_study_feedback")
    .select("kind, message, created_at")
    .eq("case_study_id", study.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const latest = feedbackRows?.[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Edit case study</h1>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href={`/app/case-studies/${study.id}/review`} className="inline-flex min-h-11 items-center underline underline-offset-2">Review sources</Link>
          <Link href={`/app/case-studies/${study.id}/template`} className="inline-flex min-h-11 items-center underline underline-offset-2">Change template</Link>
        </div>
      </div>
      {study.status === "published" && !allowed && (
        <p role="note" className="rounded-md border border-amber-700/30 bg-amber-50 p-3 text-sm text-amber-950">
          Your plan no longer includes the {template.name} template. This page stays online, but it cannot be edited or republished until you upgrade again or switch to a free template.
          {workspace.role === "owner" ? <> <Link href="/app/billing" className="underline underline-offset-2">Open billing</Link></> : null}
        </p>
      )}
      <CaseStudyEditor
        key={study.id}
        id={study.id}
        version={study.version}
        status={study.status}
        canEdit={workspace.role !== "viewer"}
        initialContent={study.content}
        initialTheme={effectiveTheme(template, study.themeSettings)}
        template={template}
        templateLocked={!allowed}
        claims={study.claims}
        logoUrl={await signedLogoUrl(study.content.client.logoPath)}
        previews={(previewRows ?? []).map((p) => ({ id: String(p.id), expires: String(p.expires_at).slice(0, 10) }))}
        blockers={blockers}
        role={workspace.role}
        slug={study.slug}
        declined={study.declined}
        clientNote={latest?.kind === "changes_requested" && typeof latest.message === "string" ? latest.message : null}
        refinedFields={study.refinedFields}
        refine={{ refine: refineTextAction, accept: acceptRefinementAction, restore: restoreOriginalAction }}
        actions={{ autosave: autosaveContentAction, saveTheme: saveThemeAction, createPreview: createPreviewLinkAction, revokePreview: revokePreviewLinkAction, requestApproval: requestApprovalAction, publish: publishAction, unpublish: unpublishAction }}
      />
    </div>
  );
}

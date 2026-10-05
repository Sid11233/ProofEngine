import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CaseStudyView } from "@/components/case-study/view/case-study-view";
import { TemplateGallery, type GalleryItem } from "@/components/case-study/template-gallery";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { loadCaseStudy } from "@/lib/case-study/load";
import { isTemplateAllowed } from "@/lib/templates/allowed";
import { defaultTemplate, loadEntitledTemplateIds, loadTemplates } from "@/lib/templates/load";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { selectTemplateAction } from "./actions";

export const metadata = { title: pageTitle("Choose a template") };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [study, workspace, templates] = await Promise.all([loadCaseStudy(supabase, id), getCurrentWorkspace(), loadTemplates(supabase)]);
  if (!study || !workspace) notFound();

  const entitled = await loadEntitledTemplateIds(supabase, study.workspaceId);
  const current = study.templateId ?? defaultTemplate(templates)?.id;

  const items: GalleryItem[] = templates.map((template) => ({
    id: template.id,
    name: template.name,
    category: template.category,
    tier: template.tier,
    allowed: isTemplateAllowed({ tier: template.tier, plan: workspace.plan, entitled: entitled.has(template.id) }),
    selected: template.id === current,
    // Thumbnails show the owner's own content in each template's default look.
    thumbnail: <CaseStudyView content={study.content} template={template} theme={template.theme} />,
  }));

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Choose a template</h1>
        <Link href={`/app/case-studies/${study.id}/review`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-2">Back to review</Link>
      </div>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">Each preview uses your own case study. Switching templates never changes what is written.</p>
      <TemplateGallery studyId={study.id} items={items} canEdit={workspace.role !== "viewer"} select={selectTemplateAction} />
    </div>
  );
}

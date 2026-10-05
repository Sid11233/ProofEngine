import { notFound } from "next/navigation";
import { CaseStudyView } from "@/components/case-study/view/case-study-view";
import { resolvePreview } from "@/lib/case-study/preview-access";
import { defaultTemplate, loadTemplates } from "@/lib/templates/load";
import { effectiveTheme } from "@/lib/templates/model";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedLogoUrl } from "@/lib/uploads/server";

// A client's view of a draft. Unlisted: the link is the only credential. Headers (noindex,
// no-referrer, no-store) are set in next.config.ts for /preview/*.
export const metadata = { title: "Draft preview", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function PreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await resolvePreview(token);

  if (!result.ok) {
    if (result.reason === "rate_limited") {
      return (
        <main className="mx-auto max-w-md px-4 py-16">
          <h1 className="text-xl font-semibold">Too many requests</h1>
          <p className="mt-2 text-neutral-600">Please wait a minute and try again.</p>
        </main>
      );
    }
    notFound();
  }

  const { data } = result;
  const templates = await loadTemplates(createAdminClient());
  const template = templates.find((t) => t.id === data.templateId) ?? defaultTemplate(templates);
  if (!template) notFound();

  return (
    <>
      <p role="note" className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-950">
        Draft preview. This is not published and may change.
      </p>
      <CaseStudyView
        content={data.content}
        template={template}
        theme={effectiveTheme(template, data.themeSettings)}
        watermark="Draft - not published"
        logoUrl={await signedLogoUrl(data.logoPath)}
      />
    </>
  );
}

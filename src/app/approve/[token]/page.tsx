import { notFound } from "next/navigation";
import { ApprovalForm } from "@/components/case-study/approval-form";
import { CaseStudyView } from "@/components/case-study/view/case-study-view";
import { resolveApproval } from "@/lib/case-study/approval-access";
import { defaultTemplate, loadTemplates } from "@/lib/templates/load";
import { effectiveTheme } from "@/lib/templates/model";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedLogoUrl } from "@/lib/uploads/server";
import { decideAction } from "./actions";

// The client's approval page. The link is the only credential. Headers (noindex, no-referrer,
// no-store) are set in next.config.ts for /approve/*.
export const metadata = { title: "Approve your case study", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await resolveApproval(token);

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

  const decide = decideAction.bind(null, token);
  return (
    <>
      <section className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <h1 className="text-2xl font-semibold">Please review your case study</h1>
        <p className="text-neutral-700">
          {data.workspaceName ? `${data.workspaceName} wrote` : "We wrote"} the page below from what you told us. Nothing is published unless you approve exactly this version.
        </p>
        <ApprovalForm decide={decide} />
      </section>
      <CaseStudyView content={data.content} template={template} theme={effectiveTheme(template, data.themeSettings)} watermark="Awaiting your approval" logoUrl={await signedLogoUrl(data.logoPath)} />
    </>
  );
}

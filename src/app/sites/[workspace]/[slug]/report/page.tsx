import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ReportForm } from "@/components/public/report-form";
import { loadPublishedStudy } from "@/lib/public/load";
import { publicViewAllowed, TOO_MANY_REQUESTS_TEXT } from "@/lib/public/view-limit";
import { publicEnv } from "@/lib/security/env.public";
import { createPublicClient } from "@/lib/supabase/public";
import { reportAction } from "./actions";

// "Report this page" / "Remove my story". Reports never remove anything by themselves: the people who
// run the page and the platform team are told and decide.
export const metadata = { title: "Report this page", robots: { index: false, follow: false } };

export default async function ReportPage({ params }: { params: Promise<{ workspace: string; slug: string }> }) {
  if (!(await publicViewAllowed(await headers()))) return <main className="mx-auto max-w-md px-4 py-16"><h1 className="text-xl font-semibold">Too many requests</h1><p className="mt-2">{TOO_MANY_REQUESTS_TEXT}</p></main>;
  const { workspace, slug } = await params;
  const study = await loadPublishedStudy(createPublicClient(), workspace, slug);
  if (!study) notFound();

  return (
    <main className="mx-auto max-w-xl space-y-5 px-4 py-12">
      <h1 className="text-2xl font-semibold">Report this page</h1>
      <p className="text-neutral-700">
        Are you the person or company in &ldquo;{study.content.headline}&rdquo; and want it removed, or is something on it wrong or harmful? Tell us and we will look at it.
      </p>
      <ReportForm workspace={workspace} slug={slug} turnstileSiteKey={publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY} nonce={(await headers()).get("x-nonce") ?? undefined} submit={reportAction} />
      <p><a href={`/${slug}`} className="text-sm underline underline-offset-2">Back to the page</a></p>
    </main>
  );
}

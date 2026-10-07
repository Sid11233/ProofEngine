import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ReportForm } from "@/components/public/report-form";
import { loadPublicDemo } from "@/lib/demos/public";
import { publicViewAllowed, TOO_MANY_REQUESTS_TEXT } from "@/lib/public/view-limit";
import { publicEnv } from "@/lib/security/env.public";
import { createPublicClient } from "@/lib/supabase/public";
import { reportDemoAction } from "./actions";

export const metadata = { title: "Report this demo", robots: { index: false, follow: false } };

export default async function ReportDemoPage({ params }: { params: Promise<{ workspace: string; slug: string }> }) {
  if (!(await publicViewAllowed(await headers()))) return <main className="mx-auto max-w-md px-4 py-16"><h1 className="text-xl font-semibold">Too many requests</h1><p className="mt-2">{TOO_MANY_REQUESTS_TEXT}</p></main>;
  const { workspace, slug } = await params;
  const demo = await loadPublicDemo(createPublicClient(), workspace, slug);
  if (!demo) notFound();
  return (
    <main className="mx-auto max-w-xl space-y-5 px-4 py-12">
      <h1 className="text-2xl font-semibold">Report this demo</h1>
      <p className="text-neutral-700">Is this demo misleading, does it show private information, or is something else wrong? Tell us and we will look at it.</p>
      <ReportForm workspace={workspace} slug={slug} turnstileSiteKey={publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY} nonce={(await headers()).get("x-nonce") ?? undefined} submit={reportDemoAction} />
      <p><a href={`/demo/${slug}`} className="text-sm underline underline-offset-2">Back to the demo</a></p>
    </main>
  );
}

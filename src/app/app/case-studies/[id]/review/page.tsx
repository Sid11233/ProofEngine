import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewEditor } from "@/components/case-study/review-editor";
import { requireUser } from "@/lib/auth/session";
import { loadCaseStudy } from "@/lib/case-study/load";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { pageTitle } from "@/lib/brand";
import { z } from "zod";
import { saveCaseStudyAction } from "../../actions";

export const metadata = { title: pageTitle("Review case study") };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  // Row-level security: another workspace's case study is simply not found.
  const study = await loadCaseStudy(await createClient(), id);
  if (!study) notFound();
  const workspace = await getCurrentWorkspace();

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Review case study</h1>
        <Link href={`/app/case-studies/${study.id}/template`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-2">Change template</Link>
      </div>
      <ReviewEditor
        // Remount on a new version so the editor starts from what was saved.
        key={study.version}
        id={study.id}
        version={study.version}
        status={study.status}
        canEdit={workspace?.role !== "viewer"}
        initial={study.content}
        claims={study.claims}
        issues={study.issues}
        save={saveCaseStudyAction}
      />
    </div>
  );
}

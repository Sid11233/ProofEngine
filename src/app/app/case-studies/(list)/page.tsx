import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";
import { ContentFade } from "@/components/motion/content-fade";
import { ListStagger } from "@/components/motion/list-stagger";

export const metadata = { title: pageTitle("Case studies") };

export default async function CaseStudiesPage() {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("case_studies")
    .select("id, status, current_version, content, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <ContentFade className="space-y-6">
      <h1 className="text-2xl font-semibold">Case studies</h1>
      {!data?.length ? (
        <p className="text-neutral-600 dark:text-neutral-400">None yet. When a client finishes an interview, generate a case study from the request page.</p>
      ) : (
        <ListStagger
          className="divide-y divide-neutral-200 rounded-md border border-neutral-200"
          items={data.map((row) => {
            const headline = typeof row.content === "object" && row.content && "headline" in row.content ? String((row.content as { headline: unknown }).headline) : "Untitled";
            return (
              <Link key={row.id} href={`/app/case-studies/${row.id}/edit`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2 anim-row">
                <span className="min-w-0 truncate font-medium">{headline}</span>
                <span className="text-xs text-neutral-600">v{row.current_version} · {row.status}</span>
              </Link>
            );
          })}
        />
      )}
    </ContentFade>
  );
}

import Link from "next/link";
import { Illustration } from "@/components/illustrations/illustration";
import { ContentFade } from "@/components/motion/content-fade";
import { ListStagger } from "@/components/motion/list-stagger";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";

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
      <PageHeader title="Case studies" subtitle={data?.length ? `${data.length} case stud${data.length === 1 ? "y" : "ies"}, newest first.` : "Written from your clients' interviews."} />
      {!data?.length ? (
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <Illustration id="GN-1" decorative className="w-56" />
          <div>
            <h2 className="text-lg font-semibold">No case studies yet</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">When a client finishes an interview, generate a case study from the request page.</p>
          </div>
          <ButtonLink href="/app/requests">Open requests</ButtonLink>
        </Card>
      ) : (
        <ListStagger
          className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface"
          itemClassName="relative hover:bg-[#fafaf9]"
          items={data.map((row) => {
            const headline = typeof row.content === "object" && row.content && "headline" in row.content ? String((row.content as { headline: unknown }).headline) : "Untitled";
            return (
              <div key={row.id} className="flex items-center gap-4 px-4 py-3">
                <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-tint text-[#b43a0c]"><Icon name="file" size={18} /></span>
                <Link href={`/app/case-studies/${row.id}/edit`} className="min-w-0 flex-1 truncate font-semibold text-foreground no-underline after:absolute after:inset-0 hover:no-underline">{headline}</Link>
                <span className="tnum hidden text-sm text-muted sm:block">v{row.current_version}</span>
                <StatusPill status={String(row.status)} />
                <Icon name="chevronRight" size={16} className="text-[#a8a29e]" />
              </div>
            );
          })}
        />
      )}
    </ContentFade>
  );
}

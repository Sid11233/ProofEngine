import Link from "next/link";
import { Illustration } from "@/components/illustrations/illustration";
import { ContentFade } from "@/components/motion/content-fade";
import { ListStagger } from "@/components/motion/list-stagger";
import { NewDemoForm } from "@/components/demos/new-demo-form";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export const metadata = { title: pageTitle("Demos") };

export default async function DemosPage() {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  const { data } = await (await createClient()).from("demos").select("id, title, status, updated:created_at").order("created_at", { ascending: false }).limit(100);
  const canCreate = workspace && workspace.role !== "viewer";

  return (
    <ContentFade className="space-y-6">
      <PageHeader title="Demos" subtitle="Interactive walkthroughs of your product that prospects can click through." />
      {canCreate ? <Card><NewDemoForm /></Card> : null}
      {!data?.length ? (
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <Illustration id="GN-1" decorative className="w-56" />
          <div>
            <h2 className="text-lg font-semibold">No demos yet</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">Upload screenshots, add a tooltip to each click, and share the link.</p>
          </div>
        </Card>
      ) : (
        <ListStagger
          className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface"
          itemClassName="relative hover:bg-[#fafaf9]"
          items={data.map((row) => (
            <div key={row.id} className="flex items-center gap-4 px-4 py-3">
              <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-tint text-[#b43a0c]"><Icon name="play" size={18} /></span>
              <Link href={`/app/demos/${row.id}`} className="min-w-0 flex-1 truncate font-semibold text-foreground no-underline after:absolute after:inset-0 hover:no-underline">{String(row.title)}</Link>
              <StatusPill status={String(row.status)} />
              <Icon name="chevronRight" size={16} className="text-[#a8a29e]" />
            </div>
          ))}
        />
      )}
    </ContentFade>
  );
}

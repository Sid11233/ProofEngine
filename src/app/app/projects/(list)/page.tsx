import Link from "next/link";
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

export const metadata = { title: pageTitle("Projects") };

const LABEL: Record<string, string> = { planning: "Planning", in_progress: "In progress", delivered: "Delivered" };

export default async function ProjectsPage() {
  await requireUser();
  const supabase = await createClient();
  const [{ data: projects }, { data: clients }] = await Promise.all([
    supabase.from("projects").select("id, client_id, name, status").order("created_at", { ascending: false }).limit(500),
    supabase.from("clients").select("id, name").limit(500),
  ]);
  const clientName = new Map((clients ?? []).map((c) => [String(c.id), String(c.name)]));

  return (
    <ContentFade className="space-y-6">
      <PageHeader title="Projects" subtitle="Everything you have built, across all clients." action={<ButtonLink href="/app/clients">Choose a client to add one</ButtonLink>} />
      {!projects?.length ? (
        <Card><p className="text-sm text-muted">No projects yet. Open a client and add one.</p></Card>
      ) : (
        <ListStagger
          className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface"
          itemClassName="relative hover:bg-[#fafaf9]"
          items={projects.map((p) => (
            <div key={p.id} className="flex items-center gap-4 px-4 py-3">
              <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-tint text-[#b43a0c]"><Icon name="grid" size={18} /></span>
              <div className="min-w-0 flex-1">
                <Link href={`/app/projects/${p.id}`} className="block truncate font-semibold text-foreground no-underline after:absolute after:inset-0 hover:no-underline">{String(p.name)}</Link>
                <p className="truncate text-sm text-muted">{clientName.get(String(p.client_id)) ?? ""}</p>
              </div>
              <StatusPill label={LABEL[String(p.status)] ?? String(p.status)} tone={p.status === "delivered" ? "green" : p.status === "planning" ? "grey" : "blue"} />
              <Icon name="chevronRight" size={16} className="text-[#a8a29e]" />
            </div>
          ))}
        />
      )}
    </ContentFade>
  );
}

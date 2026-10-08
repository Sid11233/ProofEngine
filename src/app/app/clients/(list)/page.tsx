import Link from "next/link";
import { Illustration } from "@/components/illustrations/illustration";
import { ContentFade } from "@/components/motion/content-fade";
import { ListStagger } from "@/components/motion/list-stagger";
import { ActionForm } from "@/components/ui/action-form";
import { Card, SectionLabel } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { CLIENT_FIELDS } from "@/lib/clients/fields";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { createClientAction } from "../actions";

export const metadata = { title: pageTitle("Clients") };

const LABEL: Record<string, string> = { active: "Working with them", paused: "Paused", finished: "Finished" };

export default async function ClientsPage() {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  const supabase = await createClient();
  const [{ data: clients }, { data: projects }] = await Promise.all([
    supabase.from("clients").select("id, name, status, website_url").order("name").limit(500),
    supabase.from("projects").select("client_id").limit(2000),
  ]);
  const counts = new Map<string, number>();
  for (const p of projects ?? []) counts.set(String(p.client_id), (counts.get(String(p.client_id)) ?? 0) + 1);
  const canAdd = workspace && workspace.role !== "viewer";

  return (
    <ContentFade className="space-y-6">
      <PageHeader title="Clients" subtitle="Everyone you work with, and what you built for them." />
      {canAdd ? (
        <Card aria-labelledby="add-client">
          <SectionLabel id="add-client">Add a client</SectionLabel>
          <div className="mt-3"><ActionForm compact action={createClientAction} fields={CLIENT_FIELDS} submitLabel="Add client" /></div>
        </Card>
      ) : null}
      {!clients?.length ? (
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <Illustration id="GN-1" decorative className="w-56" />
          <div>
            <h2 className="text-lg font-semibold">No clients yet</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">Add the companies you work with. Each one can have projects, links and the feedback they gave you.</p>
          </div>
        </Card>
      ) : (
        <ListStagger
          className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface"
          itemClassName="relative hover:bg-[#fafaf9]"
          items={clients.map((c) => (
            <div key={c.id} className="flex items-center gap-4 px-4 py-3">
              <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-tint text-[#b43a0c]"><Icon name="users" size={18} /></span>
              <Link href={`/app/clients/${c.id}`} className="min-w-0 flex-1 truncate font-semibold text-foreground no-underline after:absolute after:inset-0 hover:no-underline">{String(c.name)}</Link>
              <span className="tnum hidden text-sm text-muted sm:block">{counts.get(String(c.id)) ?? 0} project{(counts.get(String(c.id)) ?? 0) === 1 ? "" : "s"}</span>
              <StatusPill label={LABEL[String(c.status)] ?? String(c.status)} tone={c.status === "active" ? "green" : "grey"} />
              <Icon name="chevronRight" size={16} className="text-[#a8a29e]" />
            </div>
          ))}
        />
      )}
    </ContentFade>
  );
}

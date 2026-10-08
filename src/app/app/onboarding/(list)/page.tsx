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
import { listRequests } from "@/lib/requests/service";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export const metadata = { title: pageTitle("Onboarding") };

export default async function OnboardingPage() {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  const items = await listRequests(await createClient(), "onboarding");
  const canCreate = workspace?.role !== "viewer";

  return (
    <ContentFade className="space-y-6">
      <PageHeader title="Onboarding" subtitle="Send a new client a short AI interview and read their answers here." action={canCreate ? <ButtonLink href="/app/onboarding/new">New onboarding</ButtonLink> : undefined} />
      <p className="text-sm"><Link href="/app/onboarding/questions" className="underline underline-offset-2">Edit the onboarding questions</Link></p>
      {items.length === 0 ? (
        <Card><p className="text-sm text-muted">No onboarding interviews yet. Create one and send the link to your client.</p></Card>
      ) : (
        <ListStagger
          className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface"
          itemClassName="relative hover:bg-[#fafaf9]"
          items={items.map((i) => (
            <div key={i.id} className="flex items-center gap-4 px-4 py-3">
              <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-tint text-[#b43a0c]"><Icon name="chat" size={18} /></span>
              <Link href={`/app/requests/${i.id}`} className="min-w-0 flex-1 truncate font-semibold text-foreground no-underline after:absolute after:inset-0 hover:no-underline">{i.clientName}</Link>
              <StatusPill status={i.status} />
              <Icon name="chevronRight" size={16} className="text-[#a8a29e]" />
            </div>
          ))}
        />
      )}
    </ContentFade>
  );
}

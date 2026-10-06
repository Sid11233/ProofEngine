import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listRequests } from "@/lib/requests/service";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { pageTitle } from "@/lib/brand";
import { ContentFade } from "@/components/motion/content-fade";
import { ListStagger } from "@/components/motion/list-stagger";

export const metadata = { title: pageTitle("Requests") };

export default async function RequestsPage() {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  const items = await listRequests(await createClient());
  const canCreate = workspace?.role !== "viewer";

  return (
    <ContentFade className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Requests</h1>
        {canCreate && (
          <Link href="/app/requests/new" className="inline-flex min-h-11 items-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
            New request
          </Link>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-neutral-600 dark:text-neutral-400">No requests yet. Create one to send a client an interview link.</p>
      ) : (
        <ListStagger
          className="divide-y divide-neutral-200 rounded-md border border-neutral-200"
          items={items.map((item) => (
            <Link key={item.id} href={`/app/requests/${item.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2 hover:bg-black/[0.03]">
              <span className="min-w-0">
                <span className="block truncate font-medium">{item.clientName}</span>
                <span className="block truncate text-sm text-neutral-600">{item.projectType ?? "No project type"}</span>
              </span>
              <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs">{item.status}</span>
            </Link>
          ))}
        />
      )}
    </ContentFade>
  );
}

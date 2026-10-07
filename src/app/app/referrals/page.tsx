import { Illustration } from "@/components/illustrations/illustration";
import { ContentFade } from "@/components/motion/content-fade";
import { ReferralList } from "@/components/referrals/referral-list";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { setReferralStatusAction } from "./actions";

export const metadata = { title: pageTitle("Referrals") };

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Read through the signed-in user's client: row-level security limits this to the user's own workspaces.
export default async function ReferralsPage() {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  const { data } = await (await createClient())
    .from("referrals")
    .select("id, referred_name, referred_contact, status, created_at")
    .eq("workspace_id", workspace?.id ?? "")
    .order("created_at", { ascending: false })
    .limit(200);

  const items = (data ?? []).map((r) => ({ id: String(r.id), name: String(r.referred_name), contact: String(r.referred_contact), status: String(r.status), created: shortDate(String(r.created_at)) }));
  return (
    <ContentFade className="space-y-6">
      <PageHeader title="Referrals" subtitle="People your clients suggested. We never contact them for you." />
      {items.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <Illustration id="RF-1" decorative className="w-56" />
          <div>
            <h2 className="text-lg font-semibold">No referrals yet</h2>
            <p className="mt-1 text-sm text-muted">They appear here when a client suggests someone at the end of their interview.</p>
          </div>
        </Card>
      ) : (
        <ReferralList items={items} canEdit={workspace?.role !== "viewer"} setStatus={setReferralStatusAction} />
      )}
    </ContentFade>
  );
}

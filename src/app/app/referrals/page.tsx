import { ReferralList } from "@/components/referrals/referral-list";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { setReferralStatusAction } from "./actions";

export const metadata = { title: pageTitle("Referrals") };

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

  const items = (data ?? []).map((r) => ({ id: String(r.id), name: String(r.referred_name), contact: String(r.referred_contact), status: String(r.status), created: String(r.created_at).slice(0, 10) }));
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Referrals</h1>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">People your clients suggested. We never contact them for you.</p>
      </div>
      {items.length === 0 ? <p className="text-neutral-600 dark:text-neutral-400">No referrals yet. They appear here when a client suggests someone at the end of their interview.</p> : <ReferralList items={items} canEdit={workspace?.role !== "viewer"} setStatus={setReferralStatusAction} />}
    </div>
  );
}

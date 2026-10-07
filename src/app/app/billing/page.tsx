import "server-only";
import { redirect } from "next/navigation";
import { BillingActions } from "@/components/billing/billing-actions";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { interviewsUsedThisMonth } from "@/lib/billing/entitlements";
import { planOf } from "@/lib/billing/plans";
import { limits } from "@/lib/limits.server";
import { aiMessageLimitFor } from "@/lib/limits";
import { serverEnv } from "@/lib/security/env.server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { openPortalAction, startCheckoutAction } from "./actions";

import { ContentFade } from "@/components/motion/content-fade";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Illustration } from "@/components/illustrations/illustration";
export const metadata = { title: pageTitle("Billing") };

const fmt = (iso: unknown) => (typeof iso === "string" ? iso.slice(0, 10) : null);

// Read through the signed-in user's client. The page never trusts the checkout redirect: the plan changes
// only when Stripe's signed webhook arrives, so a "success" return just says to expect it.
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");
  const { checkout } = await searchParams;
  const supabase = await createClient();
  const period = new Date().toISOString().slice(0, 7) + "-01";
  const [{ data: sub }, interviews, { data: usage }] = await Promise.all([
    supabase.from("subscriptions").select("plan, status, current_period_end, cancel_at_period_end, past_due_since, stripe_customer_id").eq("workspace_id", workspace.id).maybeSingle(),
    interviewsUsedThisMonth(supabase, workspace.id),
    supabase.from("usage_counters").select("ai_messages").eq("workspace_id", workspace.id).eq("period", period).maybeSingle(),
  ]);
  const plan = planOf(workspace.plan);
  const configured = Boolean(serverEnv.STRIPE_SECRET_KEY && serverEnv.STRIPE_PRICE_PRO);
  const graceEnds = sub?.past_due_since ? new Date(Date.parse(String(sub.past_due_since)) + 7 * 86_400_000).toISOString().slice(0, 10) : null;

  return (
    <ContentFade className="max-w-3xl space-y-6">
      <PageHeader title="Billing" subtitle="Your plan, what you have used this month, and how to change it." art={<Illustration id={plan.id === "free" ? "BL-1" : "BL-2"} decorative />} />

      {checkout === "success" && <p role="status" className="rounded-md border border-green-700/30 bg-green-50 p-3 text-sm text-green-950">Thank you. Your plan updates as soon as our payment provider confirms the payment, usually within a minute. Refresh this page if it still says Free.</p>}
      {checkout === "cancelled" && <p role="status" className="rounded-md border border-neutral-300 p-3 text-sm">Checkout was cancelled. Nothing was charged.</p>}
      {graceEnds && <p role="alert" className="rounded-md border border-red-700/30 bg-red-50 p-3 text-sm text-red-950">Your last payment failed. Update your payment method in Manage billing before {graceEnds}, or the workspace returns to the Free plan.</p>}
      {sub?.cancel_at_period_end === true && fmt(sub.current_period_end) && <p role="note" className="rounded-md border border-neutral-300 p-3 text-sm">Your plan is set to end on {fmt(sub.current_period_end)}. After that the workspace returns to Free: published pages stay online, but pages that use a Pro template cannot be edited or republished until you upgrade again.</p>}

      <Card aria-labelledby="plan-heading" className="space-y-1">
        <h2 id="plan-heading" className="text-xs font-medium tracking-wide text-muted">Current plan</h2>
        <p className="text-2xl font-semibold" data-testid="plan-name">{plan.label}</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {plan.interviewsPerMonth} interviews a month · {plan.proTemplates ? "all templates" : "free templates"} · {plan.removesBranding ? "no Powered by line" : "Powered by line on public pages"}
        </p>
        {sub?.status && fmt(sub.current_period_end) && sub.cancel_at_period_end !== true && plan.id !== "free" ? <p className="text-sm text-muted">Renews on {fmt(sub.current_period_end)}.</p> : null}
      </Card>

      <Card aria-labelledby="usage-heading" className="space-y-3">
        <h2 id="usage-heading" className="text-xs font-medium tracking-wide text-muted">Usage this month</h2>
        <p className="text-sm">Interviews: <span className="tnum font-medium">{interviews}</span> of {plan.interviewsPerMonth}</p>
        <p className="text-sm">AI messages: <span className="tnum font-medium">{Number(usage?.ai_messages ?? 0)}</span> of {aiMessageLimitFor(plan.id, limits)}</p>
      </Card>

      {configured ? (
        <BillingActions isOwner={workspace.role === "owner"} canUpgrade={plan.id === "free"} hasCustomer={Boolean(sub?.stripe_customer_id)} upgrade={startCheckoutAction} portal={openPortalAction} />
      ) : (
        <p className="text-sm text-muted">Paid plans are not available yet.</p>
      )}
    </ContentFade>
  );
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseBillingEvent, type BillingEvent } from "./events";
import { planForPrice } from "./plans";

// Turns a signature-verified Stripe event into billing state. This file (called only by the webhook route)
// is where subscription and plan changes are made, through service-role-only SQL functions that hold the
// access rules. Idempotent: an event id is processed once; if processing fails the claim is released so
// Stripe's retry runs it again.

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

export interface BillingEnv {
  STRIPE_PRICE_PRO?: string;
}

const ACCESS_STATUSES = new Set(["active", "trialing", "past_due"]);

/** An error the event itself caused (not found, mismatch): retrying cannot help, so it is ignored. */
const isPermanent = (error: { code?: string } | null) => error?.code === "P0002" || error?.code === "22023";

async function applySubscription(admin: SupabaseClient, e: Extract<BillingEvent, { kind: "subscription" }>, env: BillingEnv): Promise<WebhookOutcome> {
  const known = planForPrice(e.priceId, env);
  // A price we do not sell never grants access. It may still END access (cancel, unpaid), so lowering the
  // plan does not depend on recognising the price.
  if (!known && ACCESS_STATUSES.has(e.status)) return "ignored";

  const { error } = await admin.rpc("apply_billing_state", {
    ws: e.workspaceId,
    customer: e.customerId,
    subscription: e.subscriptionId,
    paid_plan: known ?? "pro",
    sub_status: e.status,
    period_end: e.periodEnd?.toISOString() ?? null,
    cancels_at_end: e.cancelAtPeriodEnd,
  });
  if (error) {
    if (isPermanent(error)) return "ignored";
    throw new Error("apply_billing_state failed");
  }
  return "processed";
}

async function applyEvent(admin: SupabaseClient, e: BillingEvent, env: BillingEnv): Promise<WebhookOutcome> {
  switch (e.kind) {
    case "checkout": {
      // Only links the customer to the workspace we created the session for. The plan itself arrives with
      // the subscription events, which carry the price and the status.
      if (!e.workspaceId) return "ignored";
      const { error } = await admin.rpc("link_stripe_customer", { ws: e.workspaceId, customer: e.customerId });
      if (error) {
        if (isPermanent(error)) return "ignored";
        throw new Error("link_stripe_customer failed");
      }
      return "processed";
    }
    case "subscription":
      return applySubscription(admin, e, env);
    case "invoice": {
      const { error } = await admin.rpc("apply_invoice_state", { customer: e.customerId, paid: e.paid });
      if (error) throw new Error("apply_invoice_state failed");
      return "processed";
    }
    default:
      return "ignored";
  }
}

export async function processVerifiedEvent(
  admin: SupabaseClient,
  event: { id: string; type: string; data: { object: unknown } },
  env: BillingEnv,
): Promise<WebhookOutcome> {
  const { data: first, error: claimError } = await admin.rpc("claim_stripe_event", { event_id: event.id, event_type: event.type });
  if (claimError) throw new Error("claim_stripe_event failed");
  if (first !== true) return "duplicate";

  try {
    return await applyEvent(admin, parseBillingEvent(event), env);
  } catch (error) {
    await admin.rpc("release_stripe_event", { event_id: event.id });
    throw error;
  }
}

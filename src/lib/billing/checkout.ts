import type { SupabaseClient } from "@supabase/supabase-js";

// Checkout and the customer portal. The Stripe client and the database client are injected so this can
// be tested without a network. Nothing here takes a plan, price, amount or URL from the browser: the
// price id is server config and the return URLs are built from the app's own URL.

export interface StripeLike {
  customers: { create(params: { name: string; metadata: Record<string, string> }): Promise<{ id: string }> };
  checkout: { sessions: { create(params: Record<string, unknown>): Promise<{ url: string | null }> } };
  billingPortal: { sessions: { create(params: { customer: string; return_url: string }): Promise<{ url: string }> } };
}

export interface BillingContext {
  stripe: StripeLike;
  admin: SupabaseClient;
  appUrl: string;
}

export type BillingResult = { ok: true; url: string } | { ok: false; reason: "already_subscribed" | "no_customer" | "failed" };

const ALLOWED_HOSTS = new Set(["checkout.stripe.com", "billing.stripe.com"]);

/** Only ever send the browser to Stripe's own pages. */
export function isStripeUrl(value: string | null | undefined): value is string {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export const billingUrls = (appUrl: string) => ({
  success: new URL("/app/billing?checkout=success", appUrl).toString(),
  cancel: new URL("/app/billing?checkout=cancelled", appUrl).toString(),
  portalReturn: new URL("/app/billing", appUrl).toString(),
});

/** The workspace's Stripe customer: created once, stored through link_stripe_customer(), never replaced. */
async function customerFor(ctx: BillingContext, workspace: { id: string; name: string }): Promise<string> {
  const { data: existing } = await ctx.admin.from("subscriptions").select("stripe_customer_id").eq("workspace_id", workspace.id).maybeSingle();
  if (existing?.stripe_customer_id) return String(existing.stripe_customer_id);
  const created = await ctx.stripe.customers.create({ name: workspace.name.slice(0, 200), metadata: { workspace_id: workspace.id } });
  // If two requests raced, the database keeps the first and tells us which one won.
  const { data, error } = await ctx.admin.rpc("link_stripe_customer", { ws: workspace.id, customer: created.id });
  if (error || typeof data !== "string") throw new Error("could not store the customer");
  return data;
}

export async function createCheckout(ctx: BillingContext, workspace: { id: string; name: string; plan: string }, priceId: string): Promise<BillingResult> {
  if (workspace.plan !== "free") return { ok: false, reason: "already_subscribed" };
  try {
    const customer = await customerFor(ctx, workspace);
    const urls = billingUrls(ctx.appUrl);
    const session = await ctx.stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: workspace.id,
      metadata: { workspace_id: workspace.id },
      subscription_data: { metadata: { workspace_id: workspace.id } },
      success_url: urls.success,
      cancel_url: urls.cancel,
    });
    return isStripeUrl(session.url) ? { ok: true, url: session.url } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function createPortal(ctx: BillingContext, workspace: { id: string }): Promise<BillingResult> {
  const { data } = await ctx.admin.from("subscriptions").select("stripe_customer_id").eq("workspace_id", workspace.id).maybeSingle();
  if (!data?.stripe_customer_id) return { ok: false, reason: "no_customer" };
  try {
    const session = await ctx.stripe.billingPortal.sessions.create({ customer: String(data.stripe_customer_id), return_url: billingUrls(ctx.appUrl).portalReturn });
    return isStripeUrl(session.url) ? { ok: true, url: session.url } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

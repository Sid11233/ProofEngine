"use server";

import "server-only";
import { headers } from "next/headers";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { checkRecentAuth, REAUTH_MESSAGE, type ReauthNeeded } from "@/lib/auth/recent-auth";
import { requireUser } from "@/lib/auth/session";
import { createCheckout, createPortal } from "@/lib/billing/checkout";
import { getStripe } from "@/lib/billing/stripe";
import { getClientIp } from "@/lib/security/client-ip";
import { publicEnv } from "@/lib/security/env.public";
import { serverEnv } from "@/lib/security/env.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export interface BillingActionResult {
  ok: boolean;
  message?: string;
  reauth?: ReauthNeeded;
  /** A Stripe-hosted page to send the browser to. */
  url?: string;
}

const MESSAGES = {
  already_subscribed: "This workspace already has a paid plan. Use the billing portal to change it.",
  no_customer: "There is no billing account yet. Upgrade first.",
  failed: "We could not reach the payment provider. Please try again.",
} as const;

/** Owner only, recent sign-in required. Nothing about the plan, price or URLs comes from the request. */
async function guard(): Promise<BillingActionResult | { workspace: NonNullable<Awaited<ReturnType<typeof getCurrentWorkspace>>> }> {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace || workspace.role !== "owner") return { ok: false, message: "Only the workspace owner can manage billing." };
  if (!(await isAuthAttemptAllowed("billing", { ip: getClientIp(await headers()), subject: user.id }))) return { ok: false, message: RATE_LIMITED_MESSAGE };
  const reauth = await checkRecentAuth();
  if (reauth) return { ok: false, reauth, message: REAUTH_MESSAGE };
  return { workspace };
}

export async function startCheckoutAction(): Promise<BillingActionResult> {
  const g = await guard();
  if (!("workspace" in g)) return g;
  const stripe = getStripe();
  const priceId = serverEnv.STRIPE_PRICE_PRO;
  if (!stripe || !priceId) return { ok: false, message: "Billing is not set up yet." };
  const result = await createCheckout({ stripe, admin: createAdminClient(), appUrl: publicEnv.NEXT_PUBLIC_APP_URL }, g.workspace, priceId);
  return result.ok ? { ok: true, url: result.url } : { ok: false, message: MESSAGES[result.reason] };
}

export async function openPortalAction(): Promise<BillingActionResult> {
  const g = await guard();
  if (!("workspace" in g)) return g;
  const stripe = getStripe();
  if (!stripe) return { ok: false, message: "Billing is not set up yet." };
  const result = await createPortal({ stripe, admin: createAdminClient(), appUrl: publicEnv.NEXT_PUBLIC_APP_URL }, g.workspace);
  return result.ok ? { ok: true, url: result.url } : { ok: false, message: MESSAGES[result.reason] };
}

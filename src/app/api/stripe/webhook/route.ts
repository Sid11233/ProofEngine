import "server-only";
import { NextResponse } from "next/server";
import { processVerifiedEvent } from "@/lib/billing/webhook-core";
import { getStripe } from "@/lib/billing/stripe";
import { reportError, signal } from "@/lib/monitoring/signals";
import { getClientIp } from "@/lib/security/client-ip";
import { readLimited } from "@/lib/security/body";
import { serverEnv } from "@/lib/security/env.server";
import { sha256Hex } from "@/lib/security/hash";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe's webhook. The only thing that can change a workspace's plan from outside the database.
//   1. read the RAW body (bounded), 2. verify the signature with the webhook secret, 3. reject anything
//   unsigned or forged with 400 before reading any of it, 4. process each event id once.
// Answers carry no detail. Nothing from the event is logged except its type.

const limiter = createRateLimiter({ prefix: "stripe:ip", limit: 300, windowSec: 60 });
const MAX_BODY = 1_000_000;
const json = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = serverEnv.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return json({ error: "not_configured" }, 503);
  if (!(await limiter.limit(sha256Hex(getClientIp(request.headers)))).success) return json({ error: "rate_limited" }, 429);

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    signal("webhook_bad_signature");
    return json({ error: "invalid_signature" }, 400);
  }
  const bytes = await readLimited(request, MAX_BODY);
  if (!bytes) return json({ error: "too_large" }, 413);

  let event;
  try {
    event = stripe.webhooks.constructEvent(Buffer.from(bytes), signature, secret);
  } catch {
    signal("webhook_bad_signature");
    return json({ error: "invalid_signature" }, 400);
  }

  try {
    const outcome = await processVerifiedEvent(createAdminClient(), event, { STRIPE_PRICE_PRO: serverEnv.STRIPE_PRICE_PRO });
    return json({ received: true, outcome }, 200);
  } catch (error) {
    console.error("Stripe webhook handler failed", event.type);
    signal("webhook_failure");
    reportError(error, "stripe-webhook");
    // 500 makes Stripe retry; the event claim was released.
    return json({ error: "handler_failed" }, 500);
  }
}

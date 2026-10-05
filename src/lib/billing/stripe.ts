import "server-only";
import Stripe from "stripe";
import { serverEnv } from "@/lib/security/env.server";

let client: Stripe | null | undefined;

/** The Stripe client, or null while STRIPE_SECRET_KEY is not configured (billing is then simply off). */
export function getStripe(): Stripe | null {
  if (client === undefined) client = serverEnv.STRIPE_SECRET_KEY ? new Stripe(serverEnv.STRIPE_SECRET_KEY, { maxNetworkRetries: 1, timeout: 15_000 }) : null;
  return client;
}

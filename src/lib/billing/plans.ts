// Plans in one place. Names and prices are placeholders to decide later: only this file (and the matching
// number in the SQL function plan_interview_limit, which a test keeps in step) needs to change.

export type PlanId = "free" | "pro" | "team";

export interface PlanConfig {
  id: PlanId;
  label: string;
  /** Interviews a workspace may start per calendar month. */
  interviewsPerMonth: number;
  /** AI messages per month (the defaults in limits.ts; env overrides apply). */
  aiMessagesPerMonth: number;
  /** Templates: free ones for everyone, "pro" ones included from this plan up. */
  proTemplates: boolean;
  /** Whether the "Powered by" line is removed from public pages. */
  removesBranding: boolean;
  /** Can be bought through Checkout. "team" exists for legacy rows and is granted by hand. */
  purchasable: boolean;
}

export const PLANS: Record<PlanId, PlanConfig> = {
  free: { id: "free", label: "Free", interviewsPerMonth: 3, aiMessagesPerMonth: 100, proTemplates: false, removesBranding: false, purchasable: false },
  pro: { id: "pro", label: "Pro", interviewsPerMonth: 100, aiMessagesPerMonth: 3000, proTemplates: true, removesBranding: true, purchasable: true },
  team: { id: "team", label: "Team", interviewsPerMonth: 1000, aiMessagesPerMonth: 20000, proTemplates: true, removesBranding: true, purchasable: false },
};

/** Unknown or tampered plan values are treated as free: the safe default. */
export const planOf = (value: unknown): PlanConfig => (typeof value === "string" && value in PLANS ? PLANS[value as PlanId] : PLANS.free);

/** The plan a Stripe price id buys, from server config only. Anything else is unknown (null). */
export function planForPrice(priceId: string | undefined | null, env: { STRIPE_PRICE_PRO?: string }): PlanId | null {
  if (!priceId) return null;
  return env.STRIPE_PRICE_PRO && priceId === env.STRIPE_PRICE_PRO ? "pro" : null;
}

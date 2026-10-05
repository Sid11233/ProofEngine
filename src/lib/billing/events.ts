import { z } from "zod";

// Stripe events, narrowed. After the signature is verified we still do not trust the shape: each event
// we act on is parsed with a strict-enough zod schema into a small normalized object. Anything that does
// not fit is ignored (and the event is recorded as handled so Stripe stops retrying it).

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]+$`));
const uuid = z.uuid();
const idOrObject = (prefix: string) => z.union([id(prefix), z.object({ id: id(prefix) }).loose().transform((o) => o.id)]);

export const SUBSCRIPTION_EVENTS = ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"] as const;
export const INVOICE_EVENTS = ["invoice.payment_failed", "invoice.paid"] as const;
export const HANDLED_EVENTS = ["checkout.session.completed", ...SUBSCRIPTION_EVENTS, ...INVOICE_EVENTS] as const;

const subscriptionObject = z.object({
  id: id("sub"),
  customer: idOrObject("cus"),
  status: z.string().max(40),
  cancel_at_period_end: z.boolean().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  current_period_end: z.number().optional(),
  items: z.object({ data: z.array(z.object({ price: z.object({ id: z.string().max(100) }).loose(), current_period_end: z.number().optional() }).loose()).max(20) }).loose(),
}).loose();

const checkoutObject = z.object({
  mode: z.string(),
  customer: idOrObject("cus").nullable(),
  subscription: idOrObject("sub").nullable().optional(),
  client_reference_id: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
}).loose();

const invoiceObject = z.object({
  customer: idOrObject("cus").nullable(),
  subscription: idOrObject("sub").nullable().optional(),
}).loose();

export type BillingEvent =
  | { kind: "checkout"; workspaceId: string | null; customerId: string }
  | { kind: "subscription"; workspaceId: string | null; customerId: string; subscriptionId: string; status: string; priceId: string | null; periodEnd: Date | null; cancelAtPeriodEnd: boolean; deleted: boolean }
  | { kind: "invoice"; customerId: string; paid: boolean }
  | { kind: "ignored" };

const IGNORED: BillingEvent = { kind: "ignored" };

const workspaceFrom = (metadata: Record<string, string> | null | undefined) => {
  const parsed = uuid.safeParse(metadata?.workspace_id);
  return parsed.success ? parsed.data : null;
};

/** Narrows a verified Stripe event. Never throws: anything unexpected is "ignored". */
export function parseBillingEvent(event: { type: string; data: { object: unknown } }): BillingEvent {
  switch (event.type) {
    case "checkout.session.completed": {
      const o = checkoutObject.safeParse(event.data.object);
      if (!o.success || o.data.mode !== "subscription" || !o.data.customer) return IGNORED;
      // The workspace is the one we put in the session; if a reference id is present it must say the same.
      const fromMeta = workspaceFrom(o.data.metadata);
      const ref = uuid.safeParse(o.data.client_reference_id);
      if (fromMeta && ref.success && ref.data !== fromMeta) return IGNORED;
      return { kind: "checkout", workspaceId: fromMeta ?? (ref.success ? ref.data : null), customerId: o.data.customer };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const o = subscriptionObject.safeParse(event.data.object);
      if (!o.success) return IGNORED;
      const item = o.data.items.data[0];
      const end = item?.current_period_end ?? o.data.current_period_end;
      return {
        kind: "subscription",
        workspaceId: workspaceFrom(o.data.metadata),
        customerId: o.data.customer,
        subscriptionId: o.data.id,
        status: event.type === "customer.subscription.deleted" ? "canceled" : o.data.status,
        priceId: item?.price.id ?? null,
        periodEnd: typeof end === "number" ? new Date(end * 1000) : null,
        cancelAtPeriodEnd: o.data.cancel_at_period_end === true,
        deleted: event.type === "customer.subscription.deleted",
      };
    }
    case "invoice.payment_failed":
    case "invoice.paid": {
      const o = invoiceObject.safeParse(event.data.object);
      if (!o.success || !o.data.customer) return IGNORED;
      return { kind: "invoice", customerId: o.data.customer, paid: event.type === "invoice.paid" };
    }
    default:
      return IGNORED;
  }
}

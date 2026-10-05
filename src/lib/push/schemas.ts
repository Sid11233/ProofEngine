import { z } from "zod";
import { isAllowedPushEndpoint } from "./endpoint";

export const subscriptionSchema = z
  .object({
    endpoint: z.string().refine(isAllowedPushEndpoint, "Not a supported push service"),
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{20,30}$/),
  })
  .strict();

export const preferencesSchema = z
  .object({ clientCompleted: z.boolean(), approvalReceived: z.boolean(), referralReceived: z.boolean() })
  .strict();

export type Preferences = z.infer<typeof preferencesSchema>;
export const endpointOnlySchema = z.object({ endpoint: z.string().max(500) }).strict();

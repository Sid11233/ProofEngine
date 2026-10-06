import { z } from "zod";
import { NETWORKS, type Network } from "./networks";
import { safeProfileUrl } from "./share";

/** Optional profile links, one per network. Empty means "none". Unknown keys are rejected. */
export const profilesSchema = z
  .object(Object.fromEntries(NETWORKS.map((n) => [n, z.string().trim().max(300).optional()])) as Record<Network, z.ZodOptional<z.ZodString>>)
  .strict()
  .superRefine((value, ctx) => {
    for (const network of NETWORKS) {
      const link = value[network];
      if (link && !safeProfileUrl(network, link)) ctx.addIssue({ code: "custom", path: [network], message: "Enter a full https:// link to your own profile on this network" });
    }
  });

export type ProfilesInput = z.infer<typeof profilesSchema>;

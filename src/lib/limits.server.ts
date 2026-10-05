import "server-only";
import { resolveLimits } from "./limits";
import { serverEnv } from "./security/env.server";

/** The limits in force, from env overrides and defaults. */
export const limits = resolveLimits(serverEnv);

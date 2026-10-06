import { SPRING, type SpringName } from "./tokens";

/** A spring transition for the motion library, from a named preset. */
export const spring = (name: SpringName = "default") => ({ type: "spring" as const, ...SPRING[name] });

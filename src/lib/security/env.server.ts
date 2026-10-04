import "server-only";
import { parseServerEnv } from "./env-schema";

// Importing this from a client component is a build error (server-only).
export const serverEnv = parseServerEnv(process.env);

import { parsePublicEnv } from "./env-schema";

// Next.js only inlines NEXT_PUBLIC_ vars when they are referenced literally,
// so each one is spelled out here instead of passing process.env wholesale.
export const publicEnv = parsePublicEnv({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

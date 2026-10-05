/**
 * Session cookie hardening. Supabase's helper issues its cookies readable by JavaScript so a
 * browser client can use them. This app never talks to Supabase from the browser (every call is
 * a server action or route handler), so the session cookies are made HttpOnly: a script injected
 * through some future XSS cannot read or exfiltrate the session. Secure in production, SameSite=Lax.
 */
export type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: boolean | "lax" | "strict" | "none";
  path?: string;
  maxAge?: number;
  domain?: string;
  expires?: Date;
  [key: string]: unknown;
};

export function hardenCookie(options: CookieOptions | undefined, production = process.env.NODE_ENV === "production"): CookieOptions {
  return { ...options, httpOnly: true, secure: production, sameSite: "lax", path: options?.path ?? "/" };
}

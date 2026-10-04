import "server-only";
import { Resend } from "resend";
import { serverEnv } from "@/lib/security/env.server";
import type { EmailSender } from "./types";

/**
 * Resend-backed sender, or null when RESEND_API_KEY / RESEND_FROM_EMAIL are not
 * configured. Callers must handle null (the invite link is shown to the admin
 * to share by hand). Failures are logged without the recipient or content.
 */
export function getEmailSender(): EmailSender | null {
  const { RESEND_API_KEY: apiKey, RESEND_FROM_EMAIL: from } = serverEnv;
  if (!apiKey || !from) return null;

  const resend = new Resend(apiKey);
  return {
    async send({ to, subject, text }) {
      try {
        const { error } = await resend.emails.send({ from, to, subject, text });
        if (error) console.error("Email provider rejected a message", error.name);
        return !error;
      } catch {
        console.error("Email provider unreachable");
        return false;
      }
    },
  };
}

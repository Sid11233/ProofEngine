import { LegalDoc } from "@/components/legal/legal-doc";
import { brand } from "@/lib/brand";

export const metadata = { title: `Subprocessors | ${brand.name}` };

export const SUBPROCESSORS = [
  { name: "Supabase", purpose: "Database, sign-in (authentication) and private file storage", data: "Account and workspace data, interviews and transcripts, case studies, uploaded files", region: "To be confirmed (the region of the hosted project)" },
  { name: "Vercel", purpose: "Application hosting and content delivery", data: "Requests to the app and public pages (IP addresses in infrastructure logs)", region: "To be confirmed" },
  { name: "Anthropic", purpose: "AI models that phrase interview questions and draft case studies", data: "The text of a client's answers. Names, email addresses, tokens and ids are never sent.", region: "United States" },
  { name: "OpenAI (speech to text)", purpose: "Writing out voice answers a client chooses to record (only if enabled)", data: "The audio of a recording only. Names, email addresses, tokens and ids are never sent.", region: "United States" },
  { name: "Stripe", purpose: "Subscription payments and invoices", data: "Workspace owner billing details (card data goes to Stripe only, never to us)", region: "United States / EU" },
  { name: "Resend", purpose: "Transactional email (interview invitations, approval requests, reminders, notifications)", data: "Recipient email address and the message", region: "United States" },
  { name: "Upstash", purpose: "Rate limiting (abuse protection)", data: "Keyed hashes derived from IP addresses and tokens, held for minutes to hours", region: "To be confirmed" },
  { name: "Sentry", purpose: "Error monitoring (only if enabled)", data: "Technical error reports with request bodies, cookies and headers removed", region: "To be confirmed" },
  { name: "Cloudflare (Turnstile)", purpose: "Bot protection on public forms", data: "A challenge token and browser signals processed by Cloudflare", region: "Global" },
  { name: "Google, Mozilla, Apple (web push)", purpose: "Delivering optional push notifications to a user's own device", data: "A generic notification text and an encrypted payload; no client details", region: "Global" },
  { name: "Google (sign-in)", purpose: "Optional sign-in with a Google account", data: "Name and email address from the Google account", region: "Global" },
];

export default function SubprocessorsPage() {
  return (
    <LegalDoc title="Subprocessors" updated="October 2026">
      <p>{brand.name} uses the companies below to run the service. Each processes personal data only on our instructions and under a data processing agreement. We will update this list before adding or replacing a subprocessor, and customers can object as described in the data processing agreement.</p>
      <table>
        <thead><tr><th>Subprocessor</th><th>What it does</th><th>Data involved</th><th>Location</th></tr></thead>
        <tbody>
          {SUBPROCESSORS.map((s) => <tr key={s.name}><td><strong>{s.name}</strong></td><td>{s.purpose}</td><td>{s.data}</td><td>{s.region}</td></tr>)}
        </tbody>
      </table>
    </LegalDoc>
  );
}

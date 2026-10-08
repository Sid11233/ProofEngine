import Link from "next/link";
import { Fill, LegalDoc } from "@/components/legal/legal-doc";
import { brand } from "@/lib/brand";

export const metadata = { title: `Privacy policy | ${brand.name}` };

export default function PrivacyPage() {
  return (
    <LegalDoc title="Privacy policy" updated="October 2026">
      <p>This policy explains what personal data {brand.name} (&ldquo;we&rdquo;) handles, why, for how long, and what you can do about it. Operator: <Fill>legal company name, address, registration number</Fill>. Contact for privacy questions: <Fill>privacy contact email</Fill>.</p>

      <h2>Two kinds of people</h2>
      <p><strong>Customers</strong> (agencies and SaaS companies) create an account and a workspace. For their account we are the controller. <strong>Clients of customers</strong> are invited by a customer to answer a short interview. For that interview the customer decides why and how the data is used and we process it on the customer&rsquo;s behalf (see the <Link href="/dpa" className="underline">data processing agreement</Link>). If you were interviewed and want your data removed, use the removal link in your approval email, or ask the company that invited you.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> name, email address, a password hash (or a Google sign-in), two-factor settings, role in a workspace.</li>
        <li><strong>Workspace:</strong> name, niche, audience, website, plan, team members and invitations, billing status (card details stay with Stripe).</li>
        <li><strong>Interviews:</strong> the client&rsquo;s name and email as entered by the customer, the consent record, the transcript of questions and answers, optional uploaded logo or headshot, the credit preference, and up to three referrals (name and email or phone of a person the client suggests; we never contact them).</li>
        <li><strong>Case studies:</strong> the draft, its versions, the facts and quotes extracted from the transcript, the client&rsquo;s approval (with a keyed hash of their IP address as evidence, not the address) and any change requests.</li>
        <li><strong>Public page statistics:</strong> page views, clicks on call-to-action links and the referring website&rsquo;s hostname, with no IP address, user agent or visitor identifier stored.</li>
        <li><strong>Security and operations:</strong> an audit log of workspace changes, rate-limit counters, error reports with request bodies, cookies and headers removed.</li>
      </ul>

      <h2>Cookies and tracking</h2>
      <p>We use only the session cookie needed to keep you signed in (HttpOnly, never readable by scripts). Client interview pages and public case study pages set no cookies. We use no advertising or cross-site tracking.</p>

      <h2>How we use data, and why</h2>
      <ul>
        <li>To provide the service you or your customer asked for: interviews, case study drafting, approval, publishing (contract).</li>
        <li>To keep the service secure and prevent abuse (legitimate interests).</li>
        <li>To send service emails: invitations, approval requests, reminders (with an unsubscribe link), receipts and notifications (contract and legitimate interests).</li>
        <li>To meet legal obligations such as tax records (legal obligation).</li>
        <li>Interviews are recorded only with the client&rsquo;s consent given at the start; publishing needs the client&rsquo;s separate approval of the exact page.</li>
      </ul>

      <h2>AI</h2>
      <p>Interview questions are phrased and case studies are drafted with AI models from our subprocessor Anthropic. Only the text of a client&rsquo;s answers is sent: never names, emails, tokens or ids. The model does not decide what is published: every number and quote must match the client&rsquo;s own words, and the client approves the final page. We do not use customer or client content to train models.</p>
      <p>A client may choose to answer by voice. The recording is sent to our speech-to-text subprocessor OpenAI to be written out, and the client reads and corrects the text before sending it. The business that asked can listen to the recording for 30 days, after which it is deleted automatically; the written answer is kept like any other answer.</p>

      <h2>Who receives data</h2>
      <p>Only the companies listed on the <Link href="/subprocessors" className="underline">subprocessors page</Link>, the customer who invited you to an interview, and, for pages the client approved, the public. We do not sell personal data.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li><strong>Interviews that are never completed:</strong> deleted automatically 90 days after the last activity.</li>
        <li><strong>Deleting a workspace or account:</strong> you request it, we keep it for a 30 day grace period (public pages go offline and links stop working at once), then delete everything: interviews, transcripts, uploaded files, claims, case studies and versions, referrals. Backups are overwritten on their normal cycle (<Fill>number of days</Fill>).</li>
        <li><strong>Deleting one interview or a client&rsquo;s story:</strong> immediately, on request by the customer or through the client&rsquo;s removal link.</li>
        <li><strong>Billing records:</strong> kept as long as tax law requires (<Fill>period</Fill>).</li>
        <li><strong>Audit log:</strong> kept while the workspace exists.</li>
      </ul>

      <h2>Your rights</h2>
      <p>Depending on where you live you may have the right to access, correct, delete, restrict, object to processing of, and receive a copy of your personal data, and to complain to your data protection authority. Customers can export their workspace data and delete their workspace from the app. Clients can use their removal link. For anything else write to <Fill>privacy contact email</Fill>.</p>

      <h2>Security</h2>
      <p>Data is encrypted in transit, access is limited by workspace, secrets are never sent to browsers, interview links are random, single-purpose and stored only as hashes, and we monitor for abuse. No system is perfectly secure; we will tell affected customers promptly if there is a breach. Report a vulnerability through <code>/.well-known/security.txt</code>.</p>

      <h2>International transfers</h2>
      <p>Some subprocessors are outside your country. Where required we rely on standard contractual clauses or an adequacy decision: <Fill>mechanism to be confirmed with the lawyer</Fill>.</p>

      <h2>Children</h2>
      <p>The service is for businesses and is not directed at children.</p>

      <h2>Changes</h2>
      <p>We will post changes here and tell customers by email before material changes take effect.</p>
    </LegalDoc>
  );
}

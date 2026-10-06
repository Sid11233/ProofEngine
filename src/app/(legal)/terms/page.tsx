import Link from "next/link";
import { Fill, LegalDoc } from "@/components/legal/legal-doc";
import { brand } from "@/lib/brand";

export const metadata = { title: `Terms of service | ${brand.name}` };

export default function TermsPage() {
  return (
    <LegalDoc title="Terms of service" updated="October 2026">
      <p>These terms are between <Fill>legal company name</Fill> (&ldquo;we&rdquo;) and the business or person that creates a {brand.name} account (&ldquo;you&rdquo;). By using the service you accept them.</p>

      <h2>The service</h2>
      <p>{brand.name} lets you send clients an AI-assisted interview link, turn what they say into a draft case study, and publish pages the client has approved. Plans, limits and prices are shown in the app and may change with notice.</p>

      <h2>Your account</h2>
      <p>You are responsible for your account, for keeping credentials safe, for the people you invite and for everything done in your workspace. You must be able to enter into a contract on behalf of your business.</p>

      <h2>Your clients and consent</h2>
      <ul>
        <li>You may invite only people who have a genuine business relationship with you and may reasonably expect to hear from you.</li>
        <li>You must not write, edit or publish anything a client did not say or approve. The service enforces client approval of the exact published version; you must not try to get around it.</li>
        <li>You must act promptly on removal and takedown requests from clients and from us.</li>
        <li>You are the controller of your clients&rsquo; interview data and we are your processor (see the <Link href="/dpa" className="underline">data processing agreement</Link>).</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>No unlawful, misleading, hateful or infringing content; no fabricated reviews or testimonials; no attempts to probe, overload or bypass the security or limits of the service; no automated scraping; no use of the Light finder to spam communities. Communities have their own rules: reading and following them is your job.</p>

      <h2>Your content and ours</h2>
      <p>You keep your rights in your content and your clients&rsquo; content. You give us the right to host, process and display it to run the service, including publishing approved pages. We keep our rights in the service and its templates. We may remove content or disable a page that breaks these terms or the law, or after a credible report, and we may notify you.</p>

      <h2>Payment</h2>
      <p>Paid plans renew until cancelled and are billed through Stripe. If a payment fails we keep access for 7 days while you fix it, then move the workspace to the free plan. Published pages stay online after a downgrade, but pages that use a template no longer in your plan cannot be edited or republished until you upgrade again. <Fill>Refund policy</Fill>.</p>

      <h2>Deleting and ending</h2>
      <p>You can delete your workspace at any time; deletion completes after a 30 day grace period. We may suspend or end an account for breach of these terms, and will tell you why where we can. On ending, data is deleted as described in the privacy policy.</p>

      <h2>Availability and warranty</h2>
      <p>We work to keep the service running but provide it &ldquo;as is&rdquo;, without a promise of uninterrupted or error-free operation. AI-generated drafts can be wrong: you and your client review and approve what is published.</p>

      <h2>Liability</h2>
      <p><Fill>Limitation of liability, indemnities and exclusions: to be drafted by the lawyer.</Fill></p>

      <h2>Law and disputes</h2>
      <p><Fill>Governing law and venue.</Fill></p>

      <h2>Changes and contact</h2>
      <p>We will tell you by email before material changes. Questions: <Fill>contact email</Fill>.</p>
    </LegalDoc>
  );
}

import Link from "next/link";
import { Fill, LegalDoc } from "@/components/legal/legal-doc";
import { brand } from "@/lib/brand";

export const metadata = { title: `Data processing agreement | ${brand.name}` };

export default function DpaPage() {
  return (
    <LegalDoc title="Data processing agreement (template)" updated="October 2026">
      <p>This agreement forms part of the terms between <Fill>legal company name</Fill> (&ldquo;Processor&rdquo;) and the customer (&ldquo;Controller&rdquo;). It applies to personal data the Processor handles on the Controller&rsquo;s behalf when the Controller uses {brand.name}.</p>

      <h2>1. Subject matter and duration</h2>
      <p>Hosting and processing interview, case study and related data so the Controller can collect client stories and publish approved case studies. It lasts as long as the Controller has an account and until deletion under section 9.</p>

      <h2>2. Nature, purpose, data and people</h2>
      <ul>
        <li><strong>Nature and purpose:</strong> storage, transmission, AI-assisted drafting, display of approved pages, email delivery, deletion.</li>
        <li><strong>Types of data:</strong> names, email addresses and phone numbers, interview transcripts and quotes, uploaded images, approval records, referral details of third parties named by clients, usage and security records.</li>
        <li><strong>People:</strong> the Controller&rsquo;s clients and their employees, people those clients refer, the Controller&rsquo;s own users.</li>
      </ul>

      <h2>3. Instructions</h2>
      <p>The Processor processes personal data only on the Controller&rsquo;s documented instructions, which are the terms, this agreement and the Controller&rsquo;s use of the features. It will tell the Controller if it believes an instruction breaks data protection law.</p>

      <h2>4. Confidentiality and personnel</h2>
      <p>Everyone with access to personal data is bound by confidentiality and receives access only as needed.</p>

      <h2>5. Security</h2>
      <p>Technical and organisational measures include: encryption in transit; per-workspace access control enforced in the database; hashed, single-purpose interview and approval links; no secrets in browsers; rate limiting and abuse monitoring; private file storage with short-lived links; audit logging; regular dependency and security review; and a documented incident process. <Fill>Attach current security overview.</Fill></p>

      <h2>6. Subprocessors</h2>
      <p>The Controller authorises the subprocessors on the <Link href="/subprocessors" className="underline">subprocessors page</Link>. The Processor will give at least <Fill>30</Fill> days&rsquo; notice of changes; the Controller may object on reasonable data protection grounds, and if the parties cannot agree the Controller may end the affected service. The Processor remains responsible for its subprocessors.</p>

      <h2>7. Assistance</h2>
      <p>The Processor helps the Controller answer data subject requests (the app provides export, interview deletion, a client removal link and workspace deletion), carry out impact assessments and consult authorities, taking account of the nature of the processing.</p>

      <h2>8. Breach notification</h2>
      <p>The Processor will notify the Controller without undue delay, and within <Fill>48</Fill> hours, after becoming aware of a personal data breach affecting the Controller&rsquo;s data, with the information it has to help the Controller meet its own duties.</p>

      <h2>9. Deletion and return</h2>
      <p>The Controller can export its data at any time and delete interviews, stories and the workspace. After a deletion request and the 30 day grace period (or immediately for a single interview or a client removal) the Processor deletes the data, including stored files, and deletes remaining copies in backups on their normal cycle, unless law requires retention.</p>

      <h2>10. Audits</h2>
      <p>The Processor will provide information needed to show compliance and allow reasonable audits by the Controller or its auditor, on <Fill>30</Fill> days&rsquo; notice, not more than once a year unless a breach has occurred.</p>

      <h2>11. International transfers</h2>
      <p>Transfers outside the EEA or UK use <Fill>standard contractual clauses / adequacy decisions, to be confirmed</Fill>.</p>

      <h2>12. Liability, governing law, order of precedence</h2>
      <p><Fill>To be drafted by the lawyer.</Fill></p>
    </LegalDoc>
  );
}

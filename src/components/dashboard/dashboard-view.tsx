import Link from "next/link";
import type { DashboardData } from "@/lib/dashboard/load";
import { ViewsChart } from "./views-chart";

const card = "rounded-lg border border-neutral-200 p-4 dark:border-neutral-800";
const STATUS_LABEL: Record<string, string> = { draft: "Draft", awaiting_client_approval: "Awaiting client", approved: "Approved", published: "Published", unpublished: "Unpublished" };

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className={card}>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{hint}</p> : null}
    </div>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums">{used}{limit !== null ? ` of ${limit}` : ""}</span></div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit ?? undefined} aria-valuenow={used} className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div className={`h-full ${pct >= 90 ? "bg-red-700" : "bg-neutral-900 dark:bg-neutral-100"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function DashboardView({ data, workspaceName, plan }: { data: DashboardData; workspaceName: string; plan: string }) {
  const { funnel, caseStudies, referrals, usage, next } = data;
  const empty = funnel.sent === 0 && Object.values(caseStudies).every((n) => n === 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-neutral-600 dark:text-neutral-400">{workspaceName} · {plan} plan</p>
      </div>

      <section aria-labelledby="next-heading" className="rounded-lg border-2 border-neutral-900 p-4 dark:border-neutral-100">
        <h2 id="next-heading" className="text-sm font-medium uppercase tracking-wide text-neutral-600 dark:text-neutral-400">Next best action</h2>
        <p className="mt-1 text-lg font-semibold" data-testid="next-title">{next.title}</p>
        <p className="text-neutral-700 dark:text-neutral-300">{next.detail}</p>
        <Link href={next.href} className="mt-3 inline-flex min-h-11 items-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">{next.cta}</Link>
      </section>

      {empty ? (
        <p className={card}>No numbers yet. Send your first proof request and this page fills in as clients answer.</p>
      ) : null}

      <section aria-labelledby="funnel-heading" className="space-y-3">
        <h2 id="funnel-heading" className="text-lg font-semibold">Proof requests</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Sent" value={funnel.sent} />
          <Stat label="Started" value={funnel.started} />
          <Stat label="Completed" value={funnel.completed} />
          <Stat label="Completion rate" value={funnel.completionRate === null ? "n/a" : `${funnel.completionRate}%`} hint={funnel.completionRate === null ? "Send a request to start" : "Completed of sent"} />
        </div>
      </section>

      <section aria-labelledby="studies-heading" className="space-y-3">
        <h2 id="studies-heading" className="text-lg font-semibold">Case studies</h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {(Object.keys(caseStudies) as Array<keyof typeof caseStudies>).map((status) => (
            <li key={status} className={card}>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">{STATUS_LABEL[status]}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{caseStudies[status]}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="views-heading" className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="views-heading" className="text-lg font-semibold">Published page views, last 30 days</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400"><span className="tabular-nums font-medium">{data.totalViews}</span> views · <span className="tabular-nums font-medium">{data.ctaClicks}</span> CTA clicks · <span className="tabular-nums font-medium">{data.referralClicks}</span> referral clicks</p>
        </div>
        {data.totalViews === 0 ? <p className="text-sm text-neutral-600 dark:text-neutral-400">No views yet. Counts appear once a published page is visited. We store no IP address, no cookie and no visitor id.</p> : null}
        <ViewsChart days={data.views} />
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="ref-heading" className={`${card} space-y-3`}>
          <div className="flex items-baseline justify-between"><h2 id="ref-heading" className="text-lg font-semibold">Referrals</h2><Link href="/app/referrals" className="text-sm underline underline-offset-2">Open</Link></div>
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {(Object.keys(referrals) as Array<keyof typeof referrals>).map((s) => <li key={s} className="flex justify-between rounded-md bg-neutral-100 px-3 py-2 dark:bg-neutral-900"><span className="capitalize">{s}</span><span className="tabular-nums font-medium">{referrals[s]}</span></li>)}
          </ul>
        </section>

        <section aria-labelledby="usage-heading" className={`${card} space-y-4`}>
          <h2 id="usage-heading" className="text-lg font-semibold">Usage this month</h2>
          <Meter label="Interviews" used={usage.interviews} limit={usage.interviewLimit} />
          <Meter label="AI messages" used={usage.aiMessages} limit={usage.aiLimit} />
        </section>
      </div>
    </div>
  );
}

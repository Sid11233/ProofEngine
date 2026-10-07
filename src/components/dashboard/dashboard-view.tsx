import Link from "next/link";
import { Illustration } from "@/components/illustrations/illustration";
import type { IllustrationId } from "@/components/illustrations/library";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { ButtonLink } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import type { DashboardData } from "@/lib/dashboard/load";
import { ViewsChart } from "./views-chart";

const STATUS_LABEL: Record<string, string> = { draft: "Draft", awaiting_client_approval: "Awaiting client", approved: "Approved", published: "Published", unpublished: "Unpublished" };

/** The picture for the next best action, by what the action is. */
const ACTION_ART: Record<string, IllustrationId> = {
  publish: "PB-1", // ready to publish
  generate: "GN-1", // a finished interview waiting to become a case study
  approval: "AP-1", // a draft that needs the client's approval
  remind: "RQ-4", // clients who have not answered
  wait: "RQ-3", // waiting on the client
  first: "RQ-1", // no requests yet
  waiting: "RQ-3",
  more: "MS-3", // a milestone: everything is moving
};

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm"><span>{label}</span><span className="tnum text-muted">{used}{limit !== null ? ` of ${limit}` : ""}</span></div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit ?? undefined} aria-valuenow={used} className="h-2 overflow-hidden rounded-full bg-[#ece9e6]">
        <div className={`h-full rounded-full ${pct >= 90 ? "bg-red-700" : "bg-foreground"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** A ring that fills to the completion rate. The number beside it says the same, so the colour is never the only signal. */
function CompletionRing({ rate }: { rate: number | null }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const filled = ((rate ?? 0) / 100) * circumference;
  return (
    <svg viewBox="0 0 100 100" className="size-20 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="50" cy="50" r={radius} fill="none" stroke="#f1ece8" strokeWidth="11" />
      <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--signal)" strokeWidth="11" strokeLinecap="round" strokeDasharray={`${filled} ${circumference}`} />
    </svg>
  );
}

export function DashboardView({ data, workspaceName, plan }: { data: DashboardData; workspaceName: string; plan: string }) {
  const { funnel, caseStudies, referrals, usage, next } = data;
  const empty = funnel.sent === 0 && Object.values(caseStudies).every((n) => n === 0);
  const planLabel = `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`;

  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" subtitle={`${workspaceName} · ${planLabel}`} action={next.href === "/app/requests/new" ? undefined : <ButtonLink href="/app/requests/new">New request</ButtonLink>} />

      <Card tint aria-labelledby="next-heading" className="flex flex-wrap items-center justify-between gap-6 p-6">
        <div className="min-w-0 max-w-xl space-y-3">
          <h2 id="next-heading" className="text-xs font-semibold uppercase tracking-widest text-[#b43a0c]">Next best action</h2>
          <p className="text-xl font-semibold leading-snug" data-testid="next-title">{next.title}</p>
          <p className="text-sm text-neutral-700">{next.detail}</p>
          <ButtonLink href={next.href} className="mt-1">{next.cta}</ButtonLink>
        </div>
        <Illustration id={ACTION_ART[next.id] ?? "MS-1"} decorative className="w-40 shrink-0 sm:w-48" />
      </Card>

      {empty ? <p className="text-sm text-muted">No numbers yet. Send your first proof request and this page fills in as clients answer.</p> : null}

      <section aria-labelledby="funnel-heading" className="space-y-3">
        <SectionLabel id="funnel-heading">Proof requests</SectionLabel>
        <Card className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
          <ol className="grid grid-cols-3 items-center gap-2" aria-label="Request funnel">
            {([["Sent", funnel.sent], ["Started", funnel.started], ["Completed", funnel.completed]] as const).map(([label, n], i) => (
              <li key={label} className="relative flex items-center gap-2">
                <div>
                  <p className="text-sm text-muted">{label}</p>
                  <p className="mt-1 text-4xl font-semibold"><AnimatedNumber value={n} /></p>
                </div>
                {i < 2 ? <Icon name="chevronRight" size={20} className="absolute right-0 top-1/2 hidden -translate-y-1/2 text-[#a8a29e] sm:block" /> : null}
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-4 md:border-l md:border-line md:pl-6">
            <CompletionRing rate={funnel.completionRate} />
            <div>
              <p className="text-3xl font-semibold">{funnel.completionRate === null ? "n/a" : <AnimatedNumber value={funnel.completionRate} suffix="%" />}</p>
              <p className="text-sm text-muted">{funnel.completionRate === null ? "Send a request to start" : "completion"}</p>
            </div>
          </div>
        </Card>
      </section>

      <section aria-labelledby="studies-heading" className="space-y-3">
        <SectionLabel id="studies-heading">Case studies</SectionLabel>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {(Object.keys(caseStudies) as Array<keyof typeof caseStudies>).map((status) => (
            <li key={status}>
              <Link href="/app/case-studies" className="block overflow-hidden rounded-card border border-line bg-surface p-4 no-underline hover:border-[#d6d3d1] hover:no-underline">
                <span aria-hidden="true" className={`mb-3 block h-1 rounded-full ${caseStudies[status] > 0 ? "bg-signal" : "bg-[#e7e5e4]"}`} />
                <span className="block text-sm text-muted">{STATUS_LABEL[status]}</span>
                <span className="mt-1 block text-3xl font-semibold"><AnimatedNumber value={caseStudies[status]} /></span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <Card aria-labelledby="views-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionLabel id="views-heading">Published page views, last 30 days</SectionLabel>
          <p className="text-sm text-muted"><span className="tnum font-medium text-foreground">{data.totalViews}</span> views · <span className="tnum font-medium text-foreground">{data.ctaClicks}</span> CTA clicks · <span className="tnum font-medium text-foreground">{data.referralClicks}</span> referral clicks</p>
        </div>
        {data.totalViews === 0 ? <p className="text-sm text-muted">No views yet. Counts appear once a published page is visited. We store no IP address, no cookie and no visitor id.</p> : null}
        <ViewsChart days={data.views} />
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card aria-labelledby="ref-heading" className="space-y-3">
          <div className="flex items-baseline justify-between"><SectionLabel id="ref-heading">Referrals</SectionLabel><Link href="/app/referrals" className="text-sm font-medium">Open</Link></div>
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {(Object.keys(referrals) as Array<keyof typeof referrals>).map((s) => <li key={s} className="flex justify-between rounded-control bg-[#f5f5f4] px-3 py-2"><span className="capitalize">{s}</span><span className="tnum font-medium">{referrals[s]}</span></li>)}
          </ul>
        </Card>

        <Card aria-labelledby="usage-heading" className="space-y-4">
          <SectionLabel id="usage-heading">Usage this month</SectionLabel>
          <Meter label="Interviews" used={usage.interviews} limit={usage.interviewLimit} />
          <Meter label="AI messages" used={usage.aiMessages} limit={usage.aiLimit} />
        </Card>
      </div>
    </div>
  );
}

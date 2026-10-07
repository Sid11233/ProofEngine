import { notFound } from "next/navigation";
import { z } from "zod";
import { LeadTable } from "@/components/demos/lead-table";
import { ButtonLink } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { loadDemoResults } from "@/lib/demos/results";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export const metadata = { title: pageTitle("Demo results") };

const Stat = ({ label, value }: { label: string; value: number }) => (
  <div><p className="tnum text-2xl font-semibold">{value}</p><p className="text-sm text-muted">{label}</p></div>
);

export default async function DemoResultsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const workspace = await getCurrentWorkspace();
  const supabase = await createClient();
  // Row level security: another workspace's demo is simply not found.
  const { data: demo } = await supabase.from("demos").select("id, workspace_id, title, content").eq("id", id).maybeSingle();
  if (!demo || !workspace || demo.workspace_id !== workspace.id) notFound();
  const scenes = (demo.content as { scenes?: unknown[] } | null)?.scenes ?? [];
  const results = await loadDemoResults(supabase, id, scenes.length);
  const { data: leads } = await supabase.from("demo_leads").select("id, email, name, created_at, step_reached").eq("demo_id", id).order("created_at", { ascending: false }).limit(500);
  const top = Math.max(1, ...results.steps);

  return (
    <div className="space-y-6">
      <PageHeader title={`Results: ${String(demo.title)}`} subtitle="Counts only. We store no names, addresses or devices for views." action={<ButtonLink variant="secondary" href={`/app/demos/${id}`}>Back to the editor</ButtonLink>} />
      <Card aria-labelledby="totals">
        <SectionLabel id="totals">Totals</SectionLabel>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4"><Stat label="Views" value={results.views} /><Stat label="Finished" value={results.completions} /><Stat label="Button clicks" value={results.ctaClicks} /><Stat label="Leads" value={results.leads} /></div>
      </Card>
      <Card aria-labelledby="steps">
        <SectionLabel id="steps">Where people get to</SectionLabel>
        {results.steps.length === 0 ? <p className="mt-3 text-sm text-muted">This demo has no steps.</p> : (
          <ol className="mt-3 space-y-2">
            {results.steps.map((n, i) => (
              <li key={i} className="grid grid-cols-[4rem_1fr_3rem] items-center gap-3 text-sm">
                <span>Step {i + 1}</span>
                <span className="h-2 rounded-full bg-[#f5f5f4]"><span className="block h-2 rounded-full bg-signal" style={{ width: `${Math.round((n / top) * 100)}%` }} /></span>
                <span className="tnum text-right">{n}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card aria-labelledby="leads">
        <SectionLabel id="leads">Leads</SectionLabel>
        <div className="mt-3">
          <LeadTable demoId={id} canDelete={workspace.role === "owner" || workspace.role === "admin"} leads={(leads ?? []).map((l) => ({ id: String(l.id), email: String(l.email), name: l.name ? String(l.name) : null, created: String(l.created_at).slice(0, 10), step: l.step_reached === null ? null : Number(l.step_reached) }))} />
        </div>
        <p className="mt-3 text-xs text-muted">Visitors agreed to be contacted about this demo. Delete a lead if they ask you to.</p>
      </Card>
    </div>
  );
}

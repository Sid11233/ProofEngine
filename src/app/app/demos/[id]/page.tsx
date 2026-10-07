import { notFound } from "next/navigation";
import { z } from "zod";
import { DemoEditor } from "@/components/demos/demo-editor";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { demoContentSchema, demoSettingsSchema, demoThemeSchema } from "@/lib/demos/schema";
import { publicEnv } from "@/lib/security/env.public";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export const metadata = { title: pageTitle("Demo") };

export default async function DemoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const workspace = await getCurrentWorkspace();
  const supabase = await createClient();
  // Row level security: another workspace's demo is simply not found.
  const { data: demo } = await supabase.from("demos").select("id, workspace_id, title, status, slug, content, settings, theme, authenticity_attested, redaction_acknowledged").eq("id", id).maybeSingle();
  if (!demo || !workspace || demo.workspace_id !== workspace.id) notFound();
  const { data: assets } = await supabase.from("demo_assets").select("id, width, height, flagged").eq("demo_id", id).order("created_at");

  const { data: origins } = await supabase.from("demo_embed_origins").select("id, origin").eq("demo_id", id).order("origin");
  const sitesDomain = process.env.PUBLIC_SITES_DOMAIN;
  const subdomain = (await supabase.from("workspaces").select("subdomain_slug").eq("id", workspace.id).maybeSingle()).data?.subdomain_slug;
  const publicBase = sitesDomain && subdomain ? `${publicEnv.NEXT_PUBLIC_APP_URL.startsWith("https") ? "https" : "http"}://${subdomain}.${sitesDomain}` : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Edit demo" subtitle="Changes save automatically." action={<ButtonLink variant="secondary" href={`/app/demos/${id}/results`}>Results</ButtonLink>} />
      <DemoEditor
        role={workspace.role}
        demo={{
          id: String(demo.id), title: String(demo.title), status: String(demo.status), slug: demo.slug ? String(demo.slug) : null,
          content: demoContentSchema.catch({ scenes: [] }).parse(demo.content),
          settings: demoSettingsSchema.catch(demoSettingsSchema.parse({})).parse(demo.settings),
          theme: demoThemeSchema.catch(demoThemeSchema.parse({})).parse(demo.theme),
          attested: demo.authenticity_attested === true, redacted: demo.redaction_acknowledged === true,
        }}
        origins={(origins ?? []).map((o) => ({ id: String(o.id), origin: String(o.origin) }))}
        publicBase={publicBase}
        assets={(assets ?? []).map((a) => ({ id: String(a.id), width: Number(a.width), height: Number(a.height), flagged: a.flagged === true }))}
      />
    </div>
  );
}

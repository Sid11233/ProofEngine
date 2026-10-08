import { notFound } from "next/navigation";
import { GenerateForm, PostCard, type PostView } from "@/components/social/project-posts";
import { ButtonLink } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { idSchema } from "@/lib/clients/schemas";
import { SLIDE_KINDS, type Slide } from "@/lib/social/carousel";
import { isNetwork, NETWORK_INFO } from "@/lib/social/networks";
import { loadSources } from "@/lib/social/project-posts";
import { openUrl } from "@/lib/social/share";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { discardPostAction, editPostAction, generatePostsAction } from "./actions";

export const metadata = { title: pageTitle("Posts and carousels") };

const asSlides = (raw: unknown): Slide[] | null =>
  Array.isArray(raw)
    ? raw.flatMap((s) => {
        const o = s as { kind?: unknown; heading?: unknown; body?: unknown };
        return typeof o?.kind === "string" && (SLIDE_KINDS as readonly string[]).includes(o.kind) ? [{ kind: o.kind as Slide["kind"], heading: String(o.heading ?? ""), body: String(o.body ?? "") }] : [];
      })
    : null;

export default async function ProjectPostsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const workspace = await getCurrentWorkspace();
  const supabase = await createClient();
  // Row level security: another workspace's project is simply not found.
  const { data: project } = await supabase.from("projects").select("id, workspace_id, name").eq("id", id).maybeSingle();
  if (!project || !workspace || project.workspace_id !== workspace.id) notFound();

  const [{ data: rows }, { data: feedback }, sources, { data: profiles }] = await Promise.all([
    supabase.from("project_posts").select("id, network, kind, body, slides, status").eq("project_id", id).order("created_at"),
    supabase.from("project_feedback").select("body, author_name, source").eq("project_id", id).limit(100),
    loadSources(supabase, id),
    supabase.from("social_profiles").select("network, url").eq("workspace_id", workspace.id),
  ]);
  const profile = new Map((profiles ?? []).map((p) => [String(p.network), String(p.url)]));
  const quoteSources = (feedback ?? []).filter((f) => f.source !== "team").map((f) => ({ body: String(f.body), author: f.author_name ? String(f.author_name) : null }));
  const posts: PostView[] = (rows ?? []).flatMap((r) =>
    isNetwork(String(r.network))
      ? [{ id: String(r.id), network: r.network as PostView["network"], kind: r.kind === "carousel" ? ("carousel" as const) : ("post" as const), body: String(r.body), slides: asSlides(r.slides), status: r.status as PostView["status"], openHref: openUrl(r.network as PostView["network"], String(r.body), profile.get(String(r.network))) }]
      : [],
  );
  const canEdit = workspace.role !== "viewer";
  const slug = String(project.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";

  return (
    <div className="space-y-6">
      <PageHeader title="Posts and carousels" subtitle={`Written from what you recorded about ${String(project.name)}.`} action={<ButtonLink variant="secondary" href={`/app/projects/${id}`}>Back to the project</ButtonLink>} />
      <Card aria-labelledby="gen">
        <SectionLabel id="gen">Write new ones</SectionLabel>
        <div className="mt-3"><GenerateForm canEdit={canEdit} hasFacts={Boolean(sources && (sources.summary || sources.highlights || sources.feedback.length))} actions={{ generate: generatePostsAction.bind(null, id) }} /></div>
      </Card>
      {posts.length === 0 ? <Card><p className="text-sm text-muted">Nothing yet. Choose networks and write the first ones.</p></Card> : (
        <div className="space-y-4">
          {[...new Set(posts.map((p) => p.network))].map((n) => (
            <section key={n} className="space-y-3" aria-label={NETWORK_INFO[n].label}>
              <h2 className="text-lg font-semibold">{NETWORK_INFO[n].label}</h2>
              {posts.filter((p) => p.network === n).map((p) => (
                <PostCard key={p.id} post={p} canEdit={canEdit} brand={workspace.name} quoteSources={quoteSources} projectSlug={slug} actions={{ edit: editPostAction.bind(null, id), discard: discardPostAction.bind(null, id) }} />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

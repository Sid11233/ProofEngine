import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { ButtonLink } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { ConfirmDelete } from "@/components/ui/confirm-delete";
import { ExternalLink } from "@/components/ui/external-link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { FEEDBACK_FIELDS, LINK_FIELDS, PROJECT_FIELDS } from "@/lib/clients/fields";
import { idSchema } from "@/lib/clients/schemas";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { addFeedbackAction, addLinkAction, deleteProjectAction, removeProjectChildAction, updateProjectAction } from "../../clients/actions";

export const metadata = { title: pageTitle("Project") };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const workspace = await getCurrentWorkspace();
  const supabase = await createClient();
  // Row level security: another workspace's project is simply not found.
  const { data: project } = await supabase.from("projects").select("id, workspace_id, client_id, name, summary, key_facts, status, website_url, repo_url, notes, started_on, delivered_on").eq("id", id).maybeSingle();
  if (!project || !workspace || project.workspace_id !== workspace.id) notFound();
  const [{ data: client }, { data: links }, { data: feedback }] = await Promise.all([
    supabase.from("clients").select("id, name").eq("id", project.client_id).maybeSingle(),
    supabase.from("project_links").select("id, label, url, kind").eq("project_id", id).order("created_at"),
    supabase.from("project_feedback").select("id, source, author_name, body, created_at").eq("project_id", id).order("created_at", { ascending: false }),
  ]);
  const canEdit = workspace.role !== "viewer";
  const canDelete = workspace.role === "owner" || workspace.role === "admin";
  const defaults = Object.fromEntries(Object.entries(project).map(([k, v]) => [k, v == null ? undefined : String(v)]));

  return (
    <div className="space-y-6">
      <PageHeader title={String(project.name)} subtitle={client ? `For ${String(client.name)}` : undefined} action={<ButtonLink variant="secondary" href={client ? `/app/clients/${client.id}` : "/app/projects"}>Back</ButtonLink>} />

      <Card aria-labelledby="details">
        <SectionLabel id="details">Project details</SectionLabel>
        <div className="mt-3">
          {canEdit ? <ActionForm compact action={updateProjectAction} fields={PROJECT_FIELDS} defaults={defaults} hidden={{ id }} submitLabel="Save" /> : (
            <dl className="space-y-1 text-sm">
              {project.website_url ? <div><dt className="inline text-muted">Website: </dt><dd className="inline"><ExternalLink href={String(project.website_url)}>{String(project.website_url)}</ExternalLink></dd></div> : null}
              {project.repo_url ? <div><dt className="inline text-muted">Repository: </dt><dd className="inline"><ExternalLink href={String(project.repo_url)}>{String(project.repo_url)}</ExternalLink></dd></div> : null}
              {project.summary ? <p className="whitespace-pre-wrap">{String(project.summary)}</p> : null}
            </dl>
          )}
        </div>
      </Card>

      <Card aria-labelledby="links">
        <SectionLabel id="links">Links</SectionLabel>
        <ul className="mt-3 divide-y divide-line">
          {(links ?? []).map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-24 shrink-0 text-muted">{String(l.kind)}</span>
              <span className="min-w-0 flex-1"><span className="font-medium">{String(l.label)}</span> · <ExternalLink href={String(l.url)}>{String(l.url)}</ExternalLink></span>
              {canEdit ? <ConfirmDelete run={removeProjectChildAction.bind(null, "project_links", id, String(l.id))} label="Remove" confirm="Remove this link?" /> : null}
            </li>
          ))}
          {!links?.length ? <li className="py-2 text-sm text-muted">No links yet.</li> : null}
        </ul>
        {canEdit ? <div className="mt-4 border-t border-line pt-4"><ActionForm compact action={addLinkAction} fields={LINK_FIELDS} hidden={{ project_id: id }} submitLabel="Add link" /></div> : null}
      </Card>

      <Card aria-labelledby="posts-card">
        <SectionLabel id="posts-card">Posts and carousels</SectionLabel>
        <p className="mt-1 text-sm text-muted">Turn this project, your key facts and the client&apos;s feedback into posts and designed carousels for each network.</p>
        <div className="mt-3"><ButtonLink variant="secondary" href={`/app/projects/${id}/posts`}>Open posts and carousels</ButtonLink></div>
      </Card>

      <Card aria-labelledby="feedback">
        <SectionLabel id="feedback">Feedback</SectionLabel>
        <p className="mt-1 text-sm text-muted">What the client said about this project. Plain text; it is never changed or sent anywhere on its own.</p>
        <ul className="mt-3 space-y-3">
          {(feedback ?? []).map((f) => (
            <li key={f.id} className="rounded-control border border-line p-3 text-sm">
              <p className="whitespace-pre-wrap" data-testid="feedback-body">{String(f.body)}</p>
              <p className="mt-2 flex items-center gap-2 text-xs text-muted">
                <span>{f.author_name ? String(f.author_name) : f.source === "team" ? "Our team" : "The client"} · {String(f.created_at).slice(0, 10)}</span>
                {canEdit ? <ConfirmDelete run={removeProjectChildAction.bind(null, "project_feedback", id, String(f.id))} label="Remove" confirm="Remove this feedback?" /> : null}
              </p>
            </li>
          ))}
          {!feedback?.length ? <li className="text-sm text-muted">No feedback yet.</li> : null}
        </ul>
        {canEdit ? <div className="mt-4 border-t border-line pt-4"><ActionForm action={addFeedbackAction} fields={FEEDBACK_FIELDS} hidden={{ project_id: id }} submitLabel="Add feedback" /></div> : null}
      </Card>

      {canDelete ? <ConfirmDelete run={deleteProjectAction.bind(null, id)} label="Delete project" confirm="Delete this project with its links and feedback? This cannot be undone." redirectTo={client ? `/app/clients/${client.id}` : "/app/projects"} /> : null}
    </div>
  );
}

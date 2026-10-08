import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { ButtonLink } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { ConfirmDelete } from "@/components/ui/confirm-delete";
import { ExternalLink } from "@/components/ui/external-link";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { CLIENT_FIELDS, PROJECT_FIELDS } from "@/lib/clients/fields";
import { idSchema } from "@/lib/clients/schemas";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { createProjectAction, deleteClientAction, updateClientAction } from "../actions";

export const metadata = { title: pageTitle("Client") };

const PROJECT_LABEL: Record<string, string> = { planning: "Planning", in_progress: "In progress", delivered: "Delivered" };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const workspace = await getCurrentWorkspace();
  const supabase = await createClient();
  // Row level security: another workspace's client is simply not found.
  const { data: client } = await supabase.from("clients").select("id, workspace_id, name, contact_name, contact_email, website_url, status, notes").eq("id", id).maybeSingle();
  if (!client || !workspace || client.workspace_id !== workspace.id) notFound();
  const { data: projects } = await supabase.from("projects").select("id, name, status, website_url").eq("client_id", id).order("created_at", { ascending: false });
  const canEdit = workspace.role !== "viewer";
  const canDelete = workspace.role === "owner" || workspace.role === "admin";
  const defaults = Object.fromEntries(Object.entries(client).map(([k, v]) => [k, v == null ? undefined : String(v)]));

  return (
    <div className="space-y-6">
      <PageHeader title={String(client.name)} subtitle={client.website_url ? <ExternalLink href={String(client.website_url)}>{String(client.website_url)}</ExternalLink> : "Client"} action={<span className="flex gap-2"><ButtonLink variant="secondary" href="/app/clients">All clients</ButtonLink>{canEdit ? <ButtonLink href={`/app/onboarding/new?client=${id}`}>Send onboarding</ButtonLink> : null}</span>} />
      <Card aria-labelledby="projects">
        <SectionLabel id="projects">Projects</SectionLabel>
        {!projects?.length ? <p className="mt-3 text-sm text-muted">No projects yet.</p> : (
          <ul className="mt-3 divide-y divide-line">
            {projects.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <Link href={`/app/projects/${p.id}`} className="min-w-0 flex-1 truncate font-medium">{String(p.name)}</Link>
                <StatusPill label={PROJECT_LABEL[String(p.status)] ?? String(p.status)} tone={p.status === "delivered" ? "green" : p.status === "planning" ? "grey" : "blue"} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {canEdit ? (
        <Card aria-labelledby="add-project">
          <SectionLabel id="add-project">Add a project</SectionLabel>
          <div className="mt-3"><ActionForm compact action={createProjectAction} fields={PROJECT_FIELDS} hidden={{ client_id: id }} submitLabel="Add project" /></div>
        </Card>
      ) : null}
      <Card aria-labelledby="details">
        <SectionLabel id="details">Client details</SectionLabel>
        <div className="mt-3">
          {canEdit ? <ActionForm compact action={updateClientAction} fields={CLIENT_FIELDS} defaults={defaults} hidden={{ id }} submitLabel="Save" /> : <p className="text-sm text-muted">You can view this client but not change it.</p>}
        </div>
        {canDelete ? <div className="mt-4 border-t border-line pt-3"><ConfirmDelete run={deleteClientAction.bind(null, id)} label="Delete client" confirm="Delete this client and all of its projects, links and feedback? This cannot be undone." redirectTo="/app/clients" /></div> : null}
      </Card>
    </div>
  );
}

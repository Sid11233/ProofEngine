import type { FieldSpec } from "@/components/ui/action-form";
import { CLIENT_STATUSES, FEEDBACK_SOURCES, LINK_KINDS, PROJECT_STATUSES } from "./schemas";

const opts = (values: readonly string[], labels: Record<string, string>) => values.map((value) => ({ value, label: labels[value] ?? value }));

export const CLIENT_FIELDS: FieldSpec[] = [
  { name: "name", label: "Client name", required: true, maxLength: 200 },
  { name: "contact_name", label: "Contact person", maxLength: 200 },
  { name: "contact_email", label: "Contact email", kind: "email", maxLength: 320 },
  { name: "website_url", label: "Website", kind: "url", hint: "Starts with https://", maxLength: 300 },
  { name: "status", label: "Status", kind: "select", options: opts(CLIENT_STATUSES, { active: "Working with them", paused: "Paused", finished: "Finished" }) },
  { name: "notes", label: "Notes", kind: "textarea", hint: "Private to your team.", maxLength: 2000 },
];

export const PROJECT_FIELDS: FieldSpec[] = [
  { name: "name", label: "Project name", required: true, maxLength: 200 },
  { name: "status", label: "Status", kind: "select", options: opts(PROJECT_STATUSES, { planning: "Planning", in_progress: "In progress", delivered: "Delivered" }) },
  { name: "website_url", label: "Live website", kind: "url", hint: "Starts with https://", maxLength: 300 },
  { name: "repo_url", label: "Repository link", kind: "url", hint: "A github.com, gitlab.com or bitbucket.org link. We only keep the link, never the code.", maxLength: 300 },
  { name: "started_on", label: "Started", kind: "date" },
  { name: "delivered_on", label: "Delivered", kind: "date" },
  { name: "summary", label: "What you built", kind: "textarea", maxLength: 2000 },
  { name: "notes", label: "Private notes", kind: "textarea", hint: "Private to your team.", maxLength: 4000 },
];

export const LINK_FIELDS: FieldSpec[] = [
  { name: "label", label: "Label", required: true, maxLength: 80 },
  { name: "url", label: "Link", kind: "url", required: true, hint: "Starts with https://", maxLength: 300 },
  { name: "kind", label: "Type", kind: "select", options: opts(LINK_KINDS, { website: "Website", repo: "Repository", design: "Design", docs: "Documentation", other: "Other" }) },
];

export const FEEDBACK_FIELDS: FieldSpec[] = [
  { name: "body", label: "What they said", kind: "textarea", required: true, maxLength: 2000 },
  { name: "author_name", label: "Who said it", hint: "Optional.", maxLength: 120 },
  { name: "source", label: "From", kind: "select", options: opts(FEEDBACK_SOURCES, { client: "The client", team: "Our team" }) },
];

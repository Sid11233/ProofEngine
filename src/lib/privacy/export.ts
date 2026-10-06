import type { SupabaseClient } from "@supabase/supabase-js";
import { createZip, type ZipEntry } from "./zip";

// The owner's data export: every record of THEIR workspace as JSON files in a zip. It reads through the
// owner's own Supabase client, so row-level security decides what is included (never another workspace's
// rows, and nothing the owner could not see in the app). Secrets are not in these tables or are not granted:
// no token hashes, no push keys, no Stripe ids.

const PAGE = 1000;
const MAX_ROWS = 200_000;

interface Source {
  file: string;
  table: string;
  columns: string;
  key: string;
  order?: string;
}

export const EXPORT_SOURCES: Source[] = [
  { file: "workspace.json", table: "workspaces", columns: "id, name, type, plan, niche, audience, website, description, subdomain_slug, brand, created_at, deletion_requested_at", key: "id" },
  { file: "proof_requests.json", table: "proof_requests_safe", columns: "*", key: "workspace_id", order: "created_at" },
  { file: "interviews.json", table: "interviews", columns: "*", key: "workspace_id", order: "started_at" },
  { file: "interview_messages.json", table: "interview_messages", columns: "*", key: "workspace_id", order: "created_at" },
  { file: "interview_uploads.json", table: "interview_uploads", columns: "id, interview_id, workspace_id, kind, size_bytes, created_at", key: "workspace_id", order: "created_at" },
  { file: "referrals.json", table: "referrals", columns: "*", key: "workspace_id", order: "created_at" },
  { file: "case_studies.json", table: "case_studies", columns: "*", key: "workspace_id", order: "created_at" },
  { file: "case_study_versions.json", table: "case_study_versions", columns: "*", key: "workspace_id", order: "created_at" },
  { file: "claims.json", table: "claims", columns: "*", key: "workspace_id", order: "id" },
  { file: "approvals.json", table: "approvals", columns: "*", key: "workspace_id", order: "approved_at" },
  { file: "client_feedback.json", table: "case_study_feedback", columns: "*", key: "workspace_id", order: "created_at" },
  { file: "takedown_requests.json", table: "takedown_requests", columns: "*", key: "workspace_id", order: "created_at" },
  { file: "page_events.json", table: "page_events", columns: "*", key: "workspace_id", order: "created_at" },
  { file: "usage.json", table: "usage_counters", columns: "*", key: "workspace_id", order: "period" },
  { file: "subscription.json", table: "subscriptions", columns: "plan, status, current_period_end, cancel_at_period_end", key: "workspace_id" },
  { file: "wall_settings.json", table: "wall_settings", columns: "*", key: "workspace_id" },
  { file: "community_tracker.json", table: "workspace_communities", columns: "*", key: "workspace_id", order: "updated_at" },
  { file: "social_profiles.json", table: "social_profiles", columns: "*", key: "workspace_id" },
  { file: "social_posts.json", table: "social_posts", columns: "*", key: "workspace_id", order: "created_at" },
  { file: "signatures.json", table: "signatures", columns: "id, case_study_id, version, signer_name, signer_email, signer_company, signer_role, display_name_choice, consent_text_version, consent_web, consent_social, consent_media, method, content_hash, signed_at", key: "workspace_id", order: "signed_at" },
  { file: "signature_revocations.json", table: "signature_revocations", columns: "*", key: "workspace_id", order: "revoked_at" },
  { file: "text_refinements.json", table: "text_refinements", columns: "*", key: "workspace_id", order: "created_at" },
  { file: "audit_log.json", table: "audit_log", columns: "*", key: "workspace_id", order: "created_at" },
];

async function fetchAll(supabase: SupabaseClient, source: Source, workspaceId: string, budget: { left: number }): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from(source.table).select(source.columns).eq(source.key, workspaceId);
    if (source.order) query = query.order(source.order, { ascending: true });
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(`export of ${source.table} failed`);
    rows.push(...(data ?? []));
    budget.left -= (data ?? []).length;
    if (budget.left < 0) throw new Error("export too large");
    if ((data ?? []).length < PAGE) return rows;
  }
}

const README = `Proof Engine data export

Everything below is the data of your workspace as it is stored, one JSON file per kind of record.
It was produced for the workspace owner. It contains personal data of your clients (names, emails, interview
transcripts): handle it as you would any client data.

team.json lists the people who have access. Files uploaded by clients (logos, headshots) are not included;
they are listed in interview_uploads.json. Access tokens, password data and payment card details are never
stored in these records and are not part of the export.
`;

export interface ExportResult {
  zip: Buffer;
  counts: Record<string, number>;
}

export async function buildExport(supabase: SupabaseClient, workspaceId: string, now = new Date()): Promise<ExportResult> {
  const budget = { left: MAX_ROWS };
  const entries: ZipEntry[] = [{ name: "README.txt", data: Buffer.from(README), date: now }];
  const counts: Record<string, number> = {};

  const add = (file: string, rows: unknown[]) => {
    counts[file] = rows.length;
    entries.push({ name: file, data: Buffer.from(JSON.stringify(rows, null, 2)), date: now });
  };

  for (const source of EXPORT_SOURCES) add(source.file, await fetchAll(supabase, source, workspaceId, budget));

  // The team: through the function that only members may call (emails are not readable any other way).
  const { data: team } = await supabase.rpc("list_team_members", { ws: workspaceId });
  add("team.json", (team ?? []) as unknown[]);

  entries.push({ name: "manifest.json", data: Buffer.from(JSON.stringify({ workspaceId, exportedAt: now.toISOString(), files: counts }, null, 2)), date: now });
  return { zip: createZip(entries), counts };
}

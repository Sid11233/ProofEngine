import type { SupabaseClient } from "@supabase/supabase-js";
import { CONSENT_VERSION, type DemoEventInput, type LeadInput } from "./public-schemas";

// The service-role writes behind the public demo page. Callers have already rate limited and validated the input.
// Each write first confirms the demo is PUBLISHED right now, so a demo taken down stops collecting at once.

async function livePublishedDemo(admin: SupabaseClient, demoId: string): Promise<{ workspaceId: string; steps: number } | null> {
  const { data } = await admin.from("demos").select("workspace_id, status, content").eq("id", demoId).maybeSingle();
  if (!data || data.status !== "published") return null;
  const scenes = (data.content as { scenes?: unknown[] } | null)?.scenes;
  return { workspaceId: String(data.workspace_id), steps: Array.isArray(scenes) ? scenes.length : 0 };
}

export async function recordDemoEvent(admin: SupabaseClient, demoId: string, event: DemoEventInput): Promise<boolean> {
  const demo = await livePublishedDemo(admin, demoId);
  if (!demo) return false;
  if (event.type === "step" && (event.step === undefined || event.step >= demo.steps)) return false;
  const { error } = await admin.from("demo_events").insert({ workspace_id: demo.workspaceId, demo_id: demoId, type: event.type, step_index: event.type === "step" ? event.step : null });
  return !error;
}

export async function saveDemoLead(admin: SupabaseClient, demoId: string, lead: LeadInput): Promise<boolean> {
  const demo = await livePublishedDemo(admin, demoId);
  if (!demo) return false;
  const { error } = await admin.from("demo_leads").insert({
    workspace_id: demo.workspaceId, demo_id: demoId, email: lead.email, name: lead.name || null,
    consent: true, consent_text_version: CONSENT_VERSION, step_reached: lead.step_reached ?? null,
  });
  if (error) return false;
  await admin.from("demo_events").insert({ workspace_id: demo.workspaceId, demo_id: demoId, type: "lead", step_index: lead.step_reached ?? null });
  return true;
}

export async function saveDemoReport(admin: SupabaseClient, demoId: string, report: { reason: string; email: string }): Promise<boolean> {
  const demo = await livePublishedDemo(admin, demoId);
  if (!demo) return false;
  const { error } = await admin.from("demo_reports").insert({ demo_id: demoId, reason: report.reason, contact_email: report.email });
  return !error;
}

import "server-only";
import { z } from "zod";
import { getUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { VOICE_BUCKET } from "@/lib/interview/voice";

// A voice recording, for members of the workspace it belongs to. Row level security decides who can see the row; the
// file is then read with the service role. Anyone else gets the same 404, and an expired recording is gone.
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
const TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"]);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return notFound();
  if (!(await getUser())) return notFound();
  const { data: row } = await (await createClient()).from("interview_voice").select("file_path, mime_type, expires_at").eq("id", id).maybeSingle();
  if (!row || !TYPES.has(String(row.mime_type)) || Date.parse(String(row.expires_at)) <= Date.now()) return notFound();

  const { data: file, error } = await createAdminClient().storage.from(VOICE_BUCKET).download(String(row.file_path));
  if (error || !file) return notFound();
  return new Response(await file.arrayBuffer(), {
    headers: { "Content-Type": String(row.mime_type), "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
}

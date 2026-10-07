import "server-only";
import { z } from "zod";
import { storeDemoAsset, MAX_DEMO_UPLOAD_BYTES } from "@/lib/demos/assets";
import { getDemoStore } from "@/lib/demos/assets-server";
import { guardDemoEdit, json } from "@/lib/demos/guard";
import { readLimited } from "@/lib/security/body";
import { createAdminClient } from "@/lib/supabase/admin";

const MESSAGES: Record<string, string> = {
  too_large: "That file is larger than 5 MB.",
  empty: "That file is empty.",
  bad_extension: "Please upload a PNG, JPG or WebP image.",
  bad_content: "That file does not look like a valid PNG, JPG or WebP image.",
  limit_reached: "A demo can have at most 40 images.",
  failed: "The upload did not work. Please try again.",
};
const kindSchema = z.enum(["screenshot", "image", "logo"]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardDemoEdit(request, (await params).id);
  if (guard instanceof Response) return guard;

  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) return json({ error: "invalid" }, 400);
  const bytes = await readLimited(request, MAX_DEMO_UPLOAD_BYTES + 64 * 1024);
  if (bytes === null) return json({ error: "too_large", message: MESSAGES.too_large }, 413);

  let form: FormData;
  try {
    form = await new Response(bytes as BodyInit, { headers: { "content-type": type } }).formData();
  } catch {
    return json({ error: "invalid" }, 400);
  }
  const file = form.get("file");
  const kind = kindSchema.safeParse(form.get("kind") ?? "screenshot");
  if (!(file instanceof File) || !kind.success) return json({ error: "invalid", message: MESSAGES.bad_content }, 400);

  const result = await storeDemoAsset(
    { admin: createAdminClient(), store: getDemoStore() },
    { workspaceId: guard.workspaceId, demoId: guard.demoId },
    { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()), kind: kind.data },
  );
  if (!result.ok) return json({ error: result.error, message: MESSAGES[result.error] }, result.error === "failed" ? 500 : result.error === "too_large" ? 413 : result.error === "limit_reached" ? 409 : 400);
  return json({ id: result.id, width: result.width, height: result.height, needsConfirmation: true }, 201);
}

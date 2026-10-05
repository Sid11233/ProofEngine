import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthAttemptAllowed } from "@/lib/auth/rate-limits";
import { getUser } from "@/lib/auth/session";
import { loadCaseStudy } from "@/lib/case-study/load";
import { readLimited } from "@/lib/security/body";
import { getClientIp } from "@/lib/security/client-ip";
import { publicEnv } from "@/lib/security/env.public";
import { isSameOrigin } from "@/lib/security/origin";
import { createClient } from "@/lib/supabase/server";
import { storeLogo } from "@/lib/uploads/logo";
import { getUploadStore, signedLogoUrl } from "@/lib/uploads/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

const MAX_BYTES = 2 * 1024 * 1024 + 64 * 1024;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

const MESSAGES: Record<string, string> = {
  too_large: "That file is larger than 2 MB.",
  empty: "That file is empty.",
  bad_extension: "Please upload a PNG, JPG or WebP image.",
  bad_content: "That file does not look like a valid PNG, JPG or WebP image.",
  failed: "The upload did not work. Please try again.",
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request, publicEnv.NEXT_PUBLIC_APP_URL)) return json({ error: "forbidden" }, 403);

  const user = await getUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  const workspace = await getCurrentWorkspace();
  if (!workspace || workspace.role === "viewer") return json({ error: "forbidden" }, 403);

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: "not_found" }, 404);

  if (!(await isAuthAttemptAllowed("case-study-edit", { ip: getClientIp(request.headers), subject: user.id }))) {
    return json({ error: "rate_limited" }, 429);
  }

  // Row-level security: another workspace's case study is simply not found.
  const study = await loadCaseStudy(await createClient(), id);
  if (!study || study.workspaceId !== workspace.id) return json({ error: "not_found" }, 404);
  if (study.status === "published") return json({ error: "published", message: "Unpublish this case study before changing its logo." }, 409);

  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) return json({ error: "invalid" }, 400);
  const bytes = await readLimited(request, MAX_BYTES).catch(() => null);
  if (bytes === null) return json({ error: "too_large", message: MESSAGES.too_large }, 413);

  let file: FormDataEntryValue | null;
  try {
    file = (await new Response(bytes as BodyInit, { headers: { "content-type": type } }).formData()).get("file");
  } catch {
    return json({ error: "invalid" }, 400);
  }
  if (!(file instanceof File)) return json({ error: "invalid", message: MESSAGES.bad_content }, 400);

  const result = await storeLogo(getUploadStore(), workspace.id, { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  if (!result.ok) return json({ error: result.error, message: MESSAGES[result.error] }, result.error === "failed" ? 500 : result.error === "too_large" ? 413 : 400);

  // The path is saved into the case study by the next autosave; the database re-checks that it
  // belongs to this workspace.
  return json({ path: result.path, url: await signedLogoUrl(result.path) });
}

import { redirect } from "next/navigation";
import { WallForm } from "@/components/settings/wall-form";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { publicPageUrl } from "@/lib/public/host";
import { publicEnv } from "@/lib/security/env.public";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { saveWallSettingsAction } from "./actions";

export const metadata = { title: pageTitle("Wall of proof") };

export default async function WallSettingsPage() {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");
  const isAdmin = workspace.role === "owner" || workspace.role === "admin";
  if (!isAdmin) {
    return (
      <div className="max-w-2xl space-y-3">
        <h1 className="text-2xl font-semibold">Wall of proof</h1>
        <p>Only admins and owners can manage the embeddable widget.</p>
      </div>
    );
  }

  const { data } = await (await createClient())
    .from("wall_settings")
    .select("enabled, allowed_origins, layout, max_items")
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  const domain = process.env.PUBLIC_SITES_DOMAIN;
  const embedUrl = domain && workspace.subdomainSlug ? publicPageUrl(domain, workspace.subdomainSlug, "embed", publicEnv.NEXT_PUBLIC_APP_URL.startsWith("https")) : null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Wall of proof</h1>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">Show your published case studies on your own website. Only published, client-approved stories ever appear.</p>
      </div>
      <WallForm
        initial={{
          enabled: data?.enabled === true,
          originsText: Array.isArray(data?.allowed_origins) ? data.allowed_origins.join("\n") : "",
          layout: data?.layout === "list" ? "list" : "grid",
          maxItems: typeof data?.max_items === "number" ? data.max_items : 6,
        }}
        embedUrl={embedUrl}
        save={saveWallSettingsAction}
      />
    </div>
  );
}

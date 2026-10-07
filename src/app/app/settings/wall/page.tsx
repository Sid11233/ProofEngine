import { redirect } from "next/navigation";
import { WallForm } from "@/components/settings/wall-form";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { publicPageUrl } from "@/lib/public/host";
import { publicEnv } from "@/lib/security/env.public";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { saveWallSettingsAction } from "./actions";

import { ContentFade } from "@/components/motion/content-fade";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Illustration } from "@/components/illustrations/illustration";
export const metadata = { title: pageTitle("Wall of proof") };

export default async function WallSettingsPage() {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");
  const isAdmin = workspace.role === "owner" || workspace.role === "admin";
  if (!isAdmin) {
    return (
      <ContentFade className="max-w-2xl space-y-6">
        <PageHeader title="Wall of proof" subtitle="Only admins and owners can manage the embeddable widget." art={<Illustration id="PB-3" decorative />} />
      </ContentFade>
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
    <ContentFade className="max-w-3xl space-y-6">
      <PageHeader title="Wall of proof" subtitle="Show your published case studies on your own website. Only published, client-approved stories ever appear." art={<Illustration id="PB-3" decorative />} />
      <Card><WallForm
        initial={{
          enabled: data?.enabled === true,
          originsText: Array.isArray(data?.allowed_origins) ? data.allowed_origins.join("\n") : "",
          layout: data?.layout === "list" ? "list" : "grid",
          maxItems: typeof data?.max_items === "number" ? data.max_items : 6,
        }}
        embedUrl={embedUrl}
        save={saveWallSettingsAction}
      /></Card>
    </ContentFade>
  );
}

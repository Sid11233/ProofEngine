import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { CaseStudyView } from "@/components/case-study/view/case-study-view";
import { brand } from "@/lib/brand";
import { loadPublishedStudy, type PublicStudy } from "@/lib/public/load";
import { publicPageUrl } from "@/lib/public/host";
import { getClientIp } from "@/lib/security/client-ip";
import { publicEnv } from "@/lib/security/env.public";
import { sha256Hex } from "@/lib/security/hash";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { createPublicClient } from "@/lib/supabase/public";
import { effectiveTheme } from "@/lib/templates/model";

// A published case study. Drafts, unpublished and taken-down pages simply do not exist in the
// public view, so every one of them is the same 404. Nothing here reads a session or a cookie.

type Params = { workspace: string; slug: string };

const limiter = createRateLimiter({ prefix: "site:ip", limit: 120, windowSec: 60 });

const firstText = (study: PublicStudy) => {
  for (const section of study.content.sections) {
    const text = "body" in section && typeof section.body === "string" ? section.body : "";
    if (text) return text.slice(0, 200);
  }
  return `${study.content.headline}. A case study by ${study.workspaceName}.`;
};

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { workspace, slug } = await params;
  const study = await loadPublishedStudy(createPublicClient(), workspace, slug);
  if (!study) return { title: "Not found", robots: { index: false } };
  const domain = process.env.PUBLIC_SITES_DOMAIN ?? "";
  const url = publicPageUrl(domain, study.workspaceSlug, study.slug, publicEnv.NEXT_PUBLIC_APP_URL.startsWith("https"));
  const title = `${study.content.headline} | ${study.workspaceName}`;
  const description = firstText(study);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "article", title, description, url, siteName: study.workspaceName },
    twitter: { card: "summary", title, description },
    referrer: "strict-origin-when-cross-origin",
  };
}

export default async function PublicStudyPage({ params }: { params: Promise<Params> }) {
  const { workspace, slug } = await params;
  if (!(await limiter.limit(sha256Hex(getClientIp(await headers())))).success) {
    return <main className="mx-auto max-w-md px-4 py-16"><h1 className="text-xl font-semibold">Too many requests</h1><p className="mt-2">Please try again in a minute.</p></main>;
  }

  const anon = createPublicClient();
  const study = await loadPublishedStudy(anon, workspace, slug);
  if (!study) notFound();

  // The view already substitutes the free default when no template was chosen.
  const template = study.template;
  if (!template) notFound();

  return (
    <>
      <CaseStudyView
        content={study.content}
        template={template}
        theme={effectiveTheme(template, study.themeSettings)}
        logoUrl={study.logoPath ? `/${study.slug}/logo` : null}
      />
      {study.showBadge && (
        <footer className="px-4 py-6 text-center text-sm text-neutral-600">
          Powered by <a href={publicEnv.NEXT_PUBLIC_APP_URL} rel="noopener" className="underline underline-offset-2">{brand.name}</a>
        </footer>
      )}
    </>
  );
}

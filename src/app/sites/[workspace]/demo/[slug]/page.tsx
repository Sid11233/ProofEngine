import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PublicDemo } from "@/components/demos/public-demo";
import { brand } from "@/lib/brand";
import { loadPublicDemo } from "@/lib/demos/public";
import { publicViewAllowed, TOO_MANY_REQUESTS_TEXT } from "@/lib/public/view-limit";
import { publicEnv } from "@/lib/security/env.public";
import { createPublicClient } from "@/lib/supabase/public";

// A published demo. Drafts, unpublished and blocked demos are not in the public view, so each is the same 404.
type Params = { workspace: string; slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { workspace, slug } = await params;
  const demo = await loadPublicDemo(createPublicClient(), workspace, slug);
  if (!demo) return { title: "Not found", robots: { index: false } };
  return { title: demo.title, robots: { index: true }, referrer: "strict-origin-when-cross-origin" };
}

export default async function PublicDemoPage({ params }: { params: Promise<Params> }) {
  if (!(await publicViewAllowed(await headers()))) return <main className="mx-auto max-w-md px-4 py-16"><h1 className="text-xl font-semibold">Too many requests</h1><p className="mt-2">{TOO_MANY_REQUESTS_TEXT}</p></main>;
  const { workspace, slug } = await params;
  const demo = await loadPublicDemo(createPublicClient(), workspace, slug);
  if (!demo) notFound();
  return (
    <PublicDemo
      slug={demo.slug} title={demo.title} content={demo.content} theme={demo.theme} settings={demo.settings}
      assetBase={`/demo/${demo.slug}/asset`} reportHref={`/demo/${demo.slug}/report`} embedded={false}
      badge={demo.showBadge ? { href: publicEnv.NEXT_PUBLIC_APP_URL, name: brand.name } : null}
    />
  );
}

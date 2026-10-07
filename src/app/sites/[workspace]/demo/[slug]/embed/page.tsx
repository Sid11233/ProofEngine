import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PublicDemo } from "@/components/demos/public-demo";
import { brand } from "@/lib/brand";
import { loadPublicDemo } from "@/lib/demos/public";
import { publicViewAllowed, TOO_MANY_REQUESTS_TEXT } from "@/lib/public/view-limit";
import { publicEnv } from "@/lib/security/env.public";
import { createPublicClient } from "@/lib/supabase/public";

// The same demo for an iframe. It exists only when the owner turned embedding on AND listed at least one site;
// proxy.ts sets frame-ancestors to exactly that list (and 'none' if the list is empty or cannot be read).
export const metadata: Metadata = { title: "Demo", robots: { index: false, follow: false } };

export default async function EmbeddedDemoPage({ params }: { params: Promise<{ workspace: string; slug: string }> }) {
  if (!(await publicViewAllowed(await headers()))) return <main className="p-4"><p>{TOO_MANY_REQUESTS_TEXT}</p></main>;
  const { workspace, slug } = await params;
  const demo = await loadPublicDemo(createPublicClient(), workspace, slug);
  if (!demo || !demo.settings.allow_embed || demo.embedOrigins.length === 0) notFound();
  return (
    <PublicDemo
      slug={demo.slug} title={demo.title} content={demo.content} theme={demo.theme} settings={demo.settings}
      assetBase={`/demo/${demo.slug}/asset`} reportHref={`/demo/${demo.slug}/report`} embedded
      badge={demo.showBadge ? { href: publicEnv.NEXT_PUBLIC_APP_URL, name: brand.name } : null}
    />
  );
}

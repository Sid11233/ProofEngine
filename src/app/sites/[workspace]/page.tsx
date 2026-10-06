import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { brand } from "@/lib/brand";
import { listPublishedStudies } from "@/lib/public/load";
import { publicViewAllowed, TOO_MANY_REQUESTS_TEXT } from "@/lib/public/view-limit";
import { publicEnv } from "@/lib/security/env.public";
import { createPublicClient } from "@/lib/supabase/public";

type Params = { workspace: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { workspace } = await params;
  const list = await listPublishedStudies(createPublicClient(), workspace);
  return list ? { title: `Case studies | ${list.workspaceName}`, description: `Client results from ${list.workspaceName}.` } : { title: "Not found", robots: { index: false } };
}

// The workspace home: its published stories, newest first. A workspace with none is a 404.
export default async function SiteHome({ params }: { params: Promise<Params> }) {
  if (!(await publicViewAllowed(await headers()))) return <main className="mx-auto max-w-md px-4 py-16"><h1 className="text-xl font-semibold">Too many requests</h1><p className="mt-2">{TOO_MANY_REQUESTS_TEXT}</p></main>;
  const { workspace } = await params;
  const list = await listPublishedStudies(createPublicClient(), workspace);
  if (!list || list.items.length === 0) notFound();
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold">{list.workspaceName}</h1>
      <p className="mt-1 text-neutral-600">Client results, in their own words.</p>
      <ul className="mt-8 divide-y divide-neutral-200 border-y border-neutral-200">
        {list.items.map((item) => (
          <li key={item.slug}>
            <a href={`/${item.slug}`} className="block py-4 hover:bg-neutral-50">
              <span className="text-lg font-medium">{item.headline}</span>
              {item.clientName ? <span className="block text-sm text-neutral-600">{item.clientName}</span> : null}
            </a>
          </li>
        ))}
      </ul>
      {list.showBadge && (
        <p className="mt-10 text-center text-sm text-neutral-600">
          Powered by <a href={publicEnv.NEXT_PUBLIC_APP_URL} rel="noopener" className="underline underline-offset-2">{brand.name}</a>
        </p>
      )}
    </main>
  );
}

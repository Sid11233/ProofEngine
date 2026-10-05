"use client";

import { useEffect } from "react";

// Privacy-light analytics on public pages: no cookies, no storage, no identifier. Each call sends only the
// event type (and, for a view, the referring page, of which the server keeps the hostname alone).

type EventType = "view" | "cta_click" | "referral_click";

function send(slug: string, type: EventType, referrer?: string) {
  void fetch(`/${slug}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(referrer ? { type, referrer } : { type }),
    keepalive: true,
    credentials: "omit",
  }).catch(() => undefined);
}

/** Records one view when the page opens. Renders nothing. */
export function PageViewBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    send(slug, "view", document.referrer || undefined);
  }, [slug]);
  return null;
}

/** A link that records a click and then behaves like any other link (it never waits on the request). */
export function TrackedLink({ slug, type, href, children }: { slug: string; type: Exclude<EventType, "view">; href: string; children: React.ReactNode }) {
  return (
    <a href={href} rel="noopener" onClick={() => send(slug, type)} className="underline underline-offset-2">
      {children}
    </a>
  );
}

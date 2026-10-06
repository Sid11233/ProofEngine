"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AttractLoader } from "./attract-loader";

const SHOW_AFTER_MS = 150;
const GIVE_UP_MS = 10_000;

function internalTarget(event: MouseEvent): string | null {
  // (Next's Link calls preventDefault to navigate on the client, so a prevented default is not a reason to skip.)
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return null;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  if (url.pathname === window.location.pathname && url.search === window.location.search) return null;
  return url.pathname;
}

/**
 * Shows the loader while a click on a link is waiting for the next page (for example opening a case study). It appears
 * only if the page takes longer than 150 ms, never blocks clicks, and goes away when the new page is there. It does not
 * use loading.tsx, which would stop a missing page from answering 404.
 */
export function NavigationLoader() {
  const pathname = usePathname();
  // A click that is waiting for a page: remembers the page it left. When the pathname changes, the wait is over.
  const [wait, setWait] = useState<{ from: string; shown: boolean } | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (internalTarget(event)) setWait({ from: window.location.pathname, shown: false });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const waitingFrom = wait?.from ?? null;
  useEffect(() => {
    if (waitingFrom === null) return;
    const show = setTimeout(() => setWait((w) => (w ? { ...w, shown: true } : w)), SHOW_AFTER_MS);
    const giveUp = setTimeout(() => setWait(null), GIVE_UP_MS);
    return () => { clearTimeout(show); clearTimeout(giveUp); };
  }, [waitingFrom]);

  if (!wait || !wait.shown || wait.from !== pathname) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-36 z-40 flex justify-center px-4" data-anim="S-02">
      <div className="rounded-2xl border border-[var(--signal-soft)] bg-[var(--background)]/95 px-6 py-4 shadow-lg">
        <AttractLoader size="md" label="Opening the page" />
      </div>
    </div>
  );
}

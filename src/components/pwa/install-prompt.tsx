"use client";

import { useEffect, useState } from "react";

// A small "Install app" button for browsers that offer installation (Chrome, Edge, Android). It is only
// rendered inside the signed-in app, can be dismissed, and remembers that in localStorage. Browsers that
// have no install event (Safari, Firefox desktop) simply never show it.

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const KEY = "pe-install-dismissed";

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);

  useEffect(() => {
    if (wasDismissed() || window.matchMedia("(display-mode: standalone)").matches) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    const onInstalled = () => setEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!event) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private mode: it will simply show again next time */
    }
    setEvent(null);
  };

  return (
    <div role="region" aria-label="Install the app" className="flex items-center gap-1 text-sm">
      <button
        type="button"
        className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-3 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        onClick={async () => {
          await event.prompt();
          setEvent(null);
        }}
      >
        Install app
      </button>
      <button type="button" aria-label="Dismiss install suggestion" className="inline-flex size-11 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900" onClick={dismiss}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

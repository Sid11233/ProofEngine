"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icons";

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
    <div role="group" aria-label="Install the app" className="flex items-center gap-1">
      <button
        type="button"
        role="menuitem"
        className="flex min-h-10 flex-1 items-center gap-3 rounded-control px-2 text-left text-sm text-foreground hover:bg-black/[0.05]"
        onClick={async () => {
          await event.prompt();
          setEvent(null);
        }}
      >
        <Icon name="download" className="text-muted" />
        Install app
      </button>
      <button type="button" aria-label="Dismiss install suggestion" className="inline-flex size-9 shrink-0 items-center justify-center rounded-control text-muted hover:bg-black/[0.05]" onClick={dismiss}>
        <Icon name="x" />
      </button>
    </div>
  );
}

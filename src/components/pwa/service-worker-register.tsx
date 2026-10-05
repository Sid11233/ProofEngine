"use client";

import { useEffect } from "react";

/** Registers the worker for /app/ only, and only in production builds (in development it would cache stale chunks). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/app/" }).catch(() => undefined);
  }, []);
  return null;
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

/** A quiet delete button that asks first. `run` is a server action that checks the role again. */
export function ConfirmDelete({ run, label = "Delete", confirm, redirectTo, variant = "quiet" }: { run: () => Promise<{ ok: boolean; message?: string }>; label?: string; confirm: string; redirectTo?: string; variant?: "quiet" | "secondary" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" size="sm" variant={variant} loading={pending} onClick={() => { if (!window.confirm(confirm)) return; start(async () => { const r = await run(); if (!r.ok) setError(r.message ?? "That did not work."); else { setError(null); if (redirectTo) router.push(redirectTo); else router.refresh(); } }); }}>{label}</Button>
      {error ? <span role="alert" className="text-xs text-[#b42318]">{error}</span> : null}
    </span>
  );
}

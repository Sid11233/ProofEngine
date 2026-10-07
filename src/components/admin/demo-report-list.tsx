"use client";

import { useState, useTransition } from "react";
import type { DemoReportActionResult } from "@/app/app/admin/demo-reports/actions";
import { ReauthPrompt } from "@/components/auth/reauth-prompt";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export interface DemoReportView {
  id: string;
  demoId: string;
  demoTitle: string;
  demoStatus: string;
  workspaceName: string;
  publicUrl: string | null;
  reason: string;
  contact: string;
  status: string;
  created: string;
  openForDemo: number;
}

interface Props {
  items: DemoReportView[];
  actions: {
    block: (demoId: string, block: boolean) => Promise<DemoReportActionResult>;
    resolve: (reportId: string, status: string) => Promise<DemoReportActionResult>;
  };
}

export function DemoReportList({ items, actions }: Props) {
  const [status, setStatus] = useState<DemoReportActionResult>();
  const [retry, setRetry] = useState<{ needed: NonNullable<DemoReportActionResult["reauth"]>; run: () => void } | null>(null);
  const [pending, start] = useTransition();

  function run(task: () => Promise<DemoReportActionResult>) {
    setStatus(undefined);
    start(async () => {
      const result = await task();
      if (result.reauth) return setRetry({ needed: result.reauth, run: () => run(task) });
      setRetry(null);
      setStatus(result);
    });
  }

  return (
    <div className="space-y-4">
      <div role="status" aria-live="polite">{status?.message ? <p className={status.ok ? "text-sm text-green-800" : "text-sm text-red-700"}>{status.message}</p> : null}</div>
      {retry ? <ReauthPrompt needed={retry.needed} onDone={() => retry.run()} /> : null}
      {items.length === 0 ? <p className="text-muted">No reports.</p> : null}
      <ul className="space-y-4">
        {items.map((item) => (
          <li key={item.id}>
            <Card className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-auto font-semibold">{item.demoTitle} <span className="font-normal text-muted">({item.workspaceName})</span></p>
                <StatusPill status={item.demoStatus} />
              </div>
              <p className="text-sm text-muted">Report: {item.status} · {item.created} · {item.contact}</p>
              {item.openForDemo >= 3 ? <Callout tone="warn">{item.openForDemo} open reports for this demo. Look at it soon.</Callout> : null}
              {/* Plain text: pre-wrap keeps line breaks, nothing is interpreted as markup. */}
              <p className="whitespace-pre-wrap rounded-control bg-[#f5f5f4] p-3 text-sm" data-testid="report-reason">{item.reason}</p>
              {item.publicUrl ? <p className="text-sm"><a href={item.publicUrl} rel="noopener noreferrer" target="_blank" className="underline underline-offset-2">Open the public demo</a></p> : null}
              <div className="flex flex-wrap gap-2">
                {item.demoStatus === "blocked"
                  ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => actions.block(item.demoId, false))}>Unblock demo</Button>
                  : <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => actions.block(item.demoId, true))}>Block demo now</Button>}
                <Button size="sm" variant="quiet" disabled={pending} onClick={() => run(() => actions.resolve(item.id, "actioned"))}>Mark actioned</Button>
                <Button size="sm" variant="quiet" disabled={pending} onClick={() => run(() => actions.resolve(item.id, "dismissed"))}>Dismiss</Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

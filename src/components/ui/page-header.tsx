import type { ReactNode } from "react";

/** The top of a page: title (24 px), a muted subtitle, ONE primary action on the right, and optional art. */
export function PageHeader({ title, subtitle, action, art }: { title: string; subtitle?: ReactNode; action?: ReactNode; art?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {art ? <div className="order-last hidden w-32 shrink-0 sm:order-none sm:block">{art}</div> : null}
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

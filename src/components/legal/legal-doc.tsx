/** Shared shape of the draft legal pages: a title, a "last updated" line and readable sections. */
export function LegalDoc({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="space-y-6 leading-relaxed [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-2 [&_table]:mt-3 [&_table]:w-full [&_table]:text-left [&_table]:text-sm [&_td]:border-t [&_td]:border-neutral-200 [&_td]:py-2 [&_td]:pr-3 [&_td]:align-top [&_th]:pb-2 [&_th]:pr-3">
      <div>
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-neutral-600">Draft, last updated {updated}</p>
      </div>
      {children}
    </article>
  );
}

/** A placeholder the company must fill in before publishing. */
export const Fill = ({ children }: { children: React.ReactNode }) => <mark className="rounded bg-amber-100 px-1">[{children}]</mark>;

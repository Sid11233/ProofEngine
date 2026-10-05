import { notFound } from "next/navigation";
import { lookupUnsubscribe } from "@/lib/reminders/unsubscribe-access";
import { unsubscribeAction } from "./actions";

// Secret-link page: noindex, no-referrer, no-store headers come from next.config.ts.
export const metadata = { title: "Stop reminder emails", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ result?: string }> }) {
  const { token } = await params;
  const { result } = await searchParams;
  const info = await lookupUnsubscribe(token);
  if (!info.ok) {
    if ("limited" in info) return <main className="mx-auto max-w-md px-4 py-16"><h1 className="text-xl font-semibold">Too many requests</h1><p className="mt-2">Please wait a minute and try again.</p></main>;
    notFound();
  }

  const done = info.alreadyDone || result === "done";
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">{done ? "You are unsubscribed" : "Stop reminder emails?"}</h1>
      {done ? (
        <p>We will not email you again about {info.workspaceName}&rsquo;s request. If you change your mind, ask them for a new link.</p>
      ) : (
        <>
          <p>This stops reminder emails from {info.workspaceName} about their request for your feedback.</p>
          {result === "limited" ? <p role="alert" className="text-red-800">Too many attempts. Please try again in a minute.</p> : null}
          <form action={unsubscribeAction.bind(null, token)}>
            <button type="submit" className="inline-flex min-h-12 items-center rounded-md bg-neutral-900 px-5 font-medium text-white">Yes, stop the emails</button>
          </form>
        </>
      )}
    </main>
  );
}

import { notFound } from "next/navigation";
import { lookupRemoval } from "@/lib/privacy/removal-access";
import { removeStoryAction } from "./actions";

// Secret-link page: noindex, no-referrer, no-store headers come from next.config.ts.
export const metadata = { title: "Remove your story", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function RemovePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ result?: string }> }) {
  const { token } = await params;
  const { result } = await searchParams;

  // After a successful removal the story no longer exists, so the same link would look unknown: say so plainly.
  if (result === "done") {
    return (
      <main className="mx-auto max-w-md space-y-3 px-4 py-16">
        <h1 className="text-2xl font-semibold">Your story was removed</h1>
        <p>We deleted the case study, everything you said in the interview, any files you uploaded and your contact details from this request. If it was published, the page is gone.</p>
      </main>
    );
  }

  const info = await lookupRemoval(token);
  if (!info.ok) {
    if ("limited" in info) return <main className="mx-auto max-w-md px-4 py-16"><h1 className="text-xl font-semibold">Too many requests</h1><p className="mt-2">Please wait a minute and try again.</p></main>;
    notFound();
  }

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">Remove your story?</h1>
      <p>{info.workspaceName} wrote a case study from your interview. This permanently deletes it, everything you said in the interview, any files you uploaded and your name and email from their records. If the page is public, it comes down. This cannot be undone.</p>
      {result === "limited" ? <p role="alert" className="text-red-800">Too many attempts. Please try again in a minute.</p> : null}
      {result === "invalid" ? <p role="alert" className="text-red-800">That did not work. Please try again.</p> : null}
      <form action={removeStoryAction.bind(null, token)}>
        <button type="submit" className="inline-flex min-h-12 items-center rounded-md bg-red-800 px-5 font-medium text-white">Yes, delete everything</button>
      </form>
    </main>
  );
}

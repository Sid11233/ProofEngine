import { notFound } from "next/navigation";
import { resolveInterview } from "@/lib/interview-access";

// The interview UI arrives in Phase 3.3. This page already goes through the one
// door (resolveInterview) so every bad link gets the same 404.
export const metadata = {
  title: "Your interview",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function InterviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await resolveInterview(token);

  if (!result.ok) {
    if (result.reason === "rate_limited") {
      return (
        <main className="mx-auto max-w-md px-4 py-16">
          <h1 className="text-xl font-semibold">Too many requests</h1>
          <p className="mt-2 text-neutral-600 dark:text-neutral-400">Please wait a minute and try again.</p>
        </main>
      );
    }
    notFound();
  }

  const { view } = result.access;
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-xl font-semibold">Hi {view.clientFirstName}</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">{view.workspaceName} would like to hear about your experience.</p>
    </main>
  );
}

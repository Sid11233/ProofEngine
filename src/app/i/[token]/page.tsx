import { notFound } from "next/navigation";
import { InterviewApp } from "@/components/interview/interview-app";
import { CONSENT_TEXT } from "@/lib/interview/consent";
import { resolveInterview } from "@/lib/interview-access";
import { loadInitialState } from "@/lib/interview/state";

// Every bad link gets the same 404, via resolveInterview(). Headers (noindex, no-referrer,
// no-store) are set in next.config.ts for /i/*.
export const metadata = {
  title: "Your interview",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
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

  const { access } = result;
  const initial = await loadInitialState(access);

  return (
    <InterviewApp
      token={token}
      workspaceName={access.view.workspaceName}
      clientFirstName={access.view.clientFirstName}
      consentText={CONSENT_TEXT}
      consentVersion={access.view.consentVersion}
      initial={initial}
    />
  );
}

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { InterviewApp } from "@/components/interview/interview-app";
import { resolveInterview } from "@/lib/interview-access";
import { publicEnv } from "@/lib/security/env.public";
import { loadInitialState } from "@/lib/interview/state";
import { breakerTripped, voiceConfigured } from "@/lib/interview/server";
import { MAINTENANCE_MESSAGE } from "@/lib/interview/breaker";

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

  if (await breakerTripped()) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <h1 className="text-xl font-semibold">Back soon</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">{MAINTENANCE_MESSAGE}</p>
      </main>
    );
  }

  const { access } = result;
  const initial = await loadInitialState(access);

  return (
    <InterviewApp
      token={token}
      workspaceName={access.view.workspaceName}
      clientFirstName={access.view.clientFirstName}
      consentText={access.view.consentText}
      consentVersion={access.view.consentVersion}
      questions={access.view.questions}
      purpose={access.view.purpose}
      voiceEnabled={voiceConfigured()}
      turnstileSiteKey={publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
      nonce={(await headers()).get("x-nonce") ?? undefined}
      initial={initial}
    />
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AttractLoader } from "@/components/motion/attract-loader";

export function GenerateButton({ interviewId }: { interviewId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function generate() {
    setError(undefined);
    setPending(true);
    try {
      const response = await fetch("/api/case-studies/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interviewId }),
      });
      const data = (await response.json().catch(() => ({}))) as { caseStudyId?: string; message?: string };
      if (!response.ok || !data.caseStudyId) {
        setError(data.message ?? "Something went wrong. Please try again.");
        setPending(false);
        return;
      }
      router.push(`/app/case-studies/${data.caseStudyId}/review`);
    } catch {
      setError("Something went wrong. Please try again.");
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={generate} disabled={pending} className="inline-flex min-h-11 items-center justify-center rounded-md bg-neutral-900 px-5 py-2 text-base font-medium text-white outline-none hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900">
        {pending ? "Generating... this can take up to a minute" : "Generate case study"}
      </button>
      {pending && <AttractLoader size="md" label="Generating your case study. This can take up to a minute." />}
      <div role="alert" aria-live="polite">{error ? <p className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}</div>
    </div>
  );
}

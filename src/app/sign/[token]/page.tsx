import "server-only";
import { notFound } from "next/navigation";
import { SigningFlow } from "@/components/signing/signing-flow";
import { CaseStudyView } from "@/components/case-study/view/case-study-view";
import { defaultTemplate, loadTemplates } from "@/lib/templates/load";
import { effectiveTheme } from "@/lib/templates/model";
import { readSession, requestContext, signingService } from "@/lib/signing/access";
import { removalSecret } from "@/lib/security/ip-hash";
import { removalToken } from "@/lib/security/removal";
import { serverEnv } from "@/lib/security/env.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedLogoUrl } from "@/lib/uploads/server";
import { declineAction, requestChangesAction, sendCodeAction, signAction, verifyCodeAction } from "./actions";

// The client's signing page. The link is the only credential, and the emailed code proves who is at it.
// Headers (noindex, no-referrer, no-store) are set in next.config.ts for /sign/*.
export const metadata = { title: "Review and sign", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await signingService().loadPage(token, await readSession(token), await requestContext());

  if (!state.ok) {
    if (state.reason === "rate_limited") {
      return (
        <main className="mx-auto max-w-md px-4 py-16">
          <h1 className="text-xl font-semibold">Too many requests</h1>
          <p className="mt-2 text-neutral-600">Please wait a minute and try again.</p>
        </main>
      );
    }
    notFound();
  }

  const actions = {
    sendCode: sendCodeAction.bind(null, token),
    verifyCode: verifyCodeAction.bind(null, token),
    sign: signAction.bind(null, token),
    requestChanges: requestChangesAction.bind(null, token),
    decline: declineAction.bind(null, token),
  };

  if (state.stage === "identity") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <SigningFlow stage="identity" workspaceName={state.workspaceName} maskedEmail={state.maskedEmail} actions={actions} />
      </main>
    );
  }

  const { review } = state;
  const templates = await loadTemplates(createAdminClient());
  const template = templates.find((t) => t.id === review.templateId) ?? defaultTemplate(templates);
  if (!template) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <SigningFlow
        stage="review"
        workspaceName={review.workspaceName}
        review={{ version: review.version, workspaceName: review.workspaceName, claims: review.claims, changes: review.changes, consent: review.consent, prefill: review.prefill }}
        preview={<CaseStudyView content={review.content} template={template} theme={effectiveTheme(template, review.themeSettings)} watermark="Awaiting your signature" logoUrl={await signedLogoUrl(review.logoPath)} />}
        removalUrl={`/remove/${removalToken(removalSecret(serverEnv), review.caseStudyId)}`}
        actions={actions}
      />
    </main>
  );
}

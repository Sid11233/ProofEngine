"use client";

import { useActionState } from "react";
import type { OnboardingActionResult } from "@/app/app/onboarding/actions";
import { LinkOnce } from "@/components/requests/link-once";
import { Button, ButtonLink } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, TextInput } from "@/components/ui/fields";
import { Select } from "@/components/ui/select";

export function NewOnboardingForm({ action, clients, defaults }: {
  action: (previous: OnboardingActionResult, formData: FormData) => Promise<OnboardingActionResult>;
  clients: Array<{ id: string; name: string }>;
  defaults: { clientId?: string; clientName?: string; clientEmail?: string };
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false } as OnboardingActionResult);
  const errors = state.fieldErrors;

  if (state.ok && state.link) {
    return (
      <div className="space-y-4">
        <Callout tone="info">{state.message}</Callout>
        <LinkOnce link={state.link} />
        <ButtonLink variant="secondary" href={state.requestId ? `/app/requests/${state.requestId}` : "/app/onboarding"}>View onboarding</ButtonLink>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {clients.length > 0 ? (
        <Field label="Client record (optional)" hint="Links this onboarding to a client you added.">
          <Select name="clientId" defaultValue={defaults.clientId ?? ""}>
            <option value="">Not linked</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      ) : null}
      <Field label="Contact name" error={errors?.clientName?.[0]}><TextInput name="clientName" required maxLength={200} defaultValue={defaults.clientName ?? ""} autoComplete="off" /></Field>
      <Field label="Contact email" error={errors?.clientEmail?.[0]}><TextInput name="clientEmail" type="email" required maxLength={320} defaultValue={defaults.clientEmail ?? ""} autoComplete="off" /></Field>
      <Checkbox name="sendNow">Email the invitation to the client now</Checkbox>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>Create onboarding</Button>
        <p role="status" aria-live="polite" className="text-sm text-[#b42318]">{!state.ok ? state.message ?? "" : ""}</p>
      </div>
    </form>
  );
}

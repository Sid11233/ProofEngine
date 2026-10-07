"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton, TextField } from "@/components/auth/form-parts";
import type { RequestActionResult } from "@/app/app/requests/actions";
import { LinkOnce } from "./link-once";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";


export function NewRequestForm({
  action,
  defaultFlow,
}: {
  action: (previous: RequestActionResult, formData: FormData) => Promise<RequestActionResult>;
  defaultFlow: "agency" | "saas";
}) {
  const [state, formAction] = useActionState(action, { ok: false } as RequestActionResult);
  const errors = state.fieldErrors;

  if (state.ok && state.link) {
    return (
      <div className="space-y-4">
        <FormMessage state={state} />
        <LinkOnce link={state.link} />
        <a href={state.requestId ? `/app/requests/${state.requestId}` : "/app/requests"} className="inline-flex min-h-11 items-center text-sm underline underline-offset-2">
          View request
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <TextField label="Client name" name="clientName" autoComplete="off" errors={errors?.clientName} />
      <TextField label="Client email" name="clientEmail" type="email" autoComplete="off" errors={errors?.clientEmail} />
      <TextField label="Project type (optional)" name="projectType" required={false} hint="For example: website redesign" errors={errors?.projectType} />
      <div className="space-y-1.5">
        <label htmlFor="flowType" className="block text-sm font-medium">Interview style</label>
        <Select id="flowType" name="flowType" defaultValue={defaultFlow} className="w-full">
          <option value="agency">Agency (client of a service)</option>
          <option value="saas">SaaS (customer of a product)</option>
        </Select>
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Outcomes to focus on (up to 3, optional)</legend>
        <TextField label="Outcome 1" name="outcome1" required={false} errors={errors?.outcome1} />
        <TextField label="Outcome 2" name="outcome2" required={false} errors={errors?.outcome2} />
        <TextField label="Outcome 3" name="outcome3" required={false} errors={errors?.outcome3} />
      </fieldset>
      <div className="space-y-1.5">
        <label htmlFor="tone" className="block text-sm font-medium">Tone</label>
        <Select id="tone" name="tone" defaultValue="friendly" className="w-full">
          <option value="friendly">Friendly</option>
          <option value="professional">Professional</option>
          <option value="casual">Casual</option>
        </Select>
      </div>
      <Checkbox name="sendNow">Email the invitation to the client now</Checkbox>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Creating...">Create request</SubmitButton>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { createDemoAction, type DemoActionResult } from "@/app/app/demos/actions";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "./fields";

export function NewDemoForm() {
  const [state, action, pending] = useActionState<DemoActionResult | null, FormData>(createDemoAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-[14rem] flex-1"><Field label="New demo"><TextInput name="title" required maxLength={120} placeholder="For example: Onboarding walkthrough" /></Field></div>
      <Button type="submit" loading={pending}>Create demo</Button>
      {state && !state.ok ? <p role="alert" className="basis-full text-sm text-[#b42318]">{state.message}</p> : null}
    </form>
  );
}

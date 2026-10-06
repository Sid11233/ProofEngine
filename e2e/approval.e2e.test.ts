import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { BASE, createUser, newPage, openVerifiedSigningLink, signIn, startStack, stopStack, type Stack } from "./harness";

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

const MESSAGE = "We cut onboarding time by 40 percent in March and support tickets fell from 1,200 to 300.";

async function seed(userId: string) {
  const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", userId).single();
  const ws = String(member?.workspace_id);
  await stack.admin.from("workspaces").update({ plan: "pro", subdomain_slug: `e2e-${randomBytes(4).toString("hex")}` }).eq("id", ws);
  const { data: request } = await stack.admin.from("proof_requests").insert({ workspace_id: ws, client_name: "Dana Doe", client_email: "d@example.test", flow_type: "agency", token_hash: randomBytes(32).toString("hex"), expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: "completed" }).select("id").single();
  const { data: interview } = await stack.admin.from("interviews").insert({ request_id: request?.id, workspace_id: ws, status: "completed", consent_given: true, question_index: 6 }).select("id").single();
  const { data: message } = await stack.admin.from("interview_messages").insert({ interview_id: interview?.id, workspace_id: ws, role: "client", content: MESSAGE }).select("id").single();
  const { data: study } = await stack.admin.from("case_studies").insert({ workspace_id: ws, interview_id: interview?.id, content: {}, status: "draft" }).select("id").single();
  const { data: claim } = await stack.admin.from("claims").insert({ case_study_id: study?.id, workspace_id: ws, text: "Onboarding fell 40 percent", source_message_id: message?.id, source_quote: "cut onboarding time by 40 percent", client_confirmed: false }).select("id").single();
  const content = {
    headline: "Faster onboarding",
    client: { name: "Dana" },
    sections: [
      { type: "challenge", title: "The challenge", body: "Onboarding was slow." },
      { type: "results", title: "Results", metrics: [{ label: "Onboarding time cut", value: "40 percent", claimId: claim?.id }] },
    ],
    tags: [],
  };
  await stack.admin.from("case_studies").update({ content }).eq("id", study?.id);
  await stack.admin.from("case_study_versions").insert({ case_study_id: study?.id, workspace_id: ws, version: 1, content });
  return String(study?.id);
}

async function ownerPage(email: string, password: string, studyId: string) {
  const page = await newPage(stack);
  await signIn(page, email, password);
  await page.waitForURL(`${BASE}/app/dashboard`);
  await page.goto(`${BASE}/app/case-studies/${studyId}/edit`);
  await page.getByRole("heading", { name: "Approval and publishing" }).waitFor();
  return page;
}

/** Asks for approval as the owner and returns the one-time link shown on screen. */
async function requestLink(page: Awaited<ReturnType<typeof ownerPage>>) {
  await page.getByRole("button", { name: /Request client approval and signature|Send a new signing link/ }).click();
  const input = page.getByLabel("Approval link");
  await input.waitFor();
  return input.inputValue();
}

const status = async (id: string) => String((await stack.admin.from("case_studies").select("status").eq("id", id).single()).data?.status);

describe("client approval and publishing", () => {
  it("goes from draft to approved to published, and a client can only approve what they were shown", async () => {
    const owner = await createUser(stack.admin, "ap-flow");
    const studyId = await seed(owner.id);
    const page = await ownerPage(owner.email, owner.password, studyId);
    expect(await page.getByRole("button", { name: "Publish", exact: true }).count()).toBe(0);

    const link = await requestLink(page);
    expect(link).toMatch(/\/sign\/[A-Za-z0-9_-]{43}$/);
    expect(await status(studyId)).toBe("awaiting_client_approval");

    // The client opens the link signed out.
    const client = await newPage(stack);
    const response = await client.goto(link);
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response?.headers()["cache-control"]).toContain("no-store");
    // Before the emailed code, the page shows nothing of the story.
    await client.getByRole("button", { name: "Email me a code" }).waitFor();
    expect(await client.getByText("Faster onboarding").count()).toBe(0);
    // The test cannot read the email, so it records a correct code check and gives the browser its session.
    await openVerifiedSigningLink(client, stack, link.split("/sign/")[1]);
    await client.goto(link);
    await client.getByRole("heading", { name: "Please review and sign" }).waitFor();
    await client.getByText("Faster onboarding").first().waitFor();
    await client.getByText("LAWYER REVIEW REQUIRED").waitFor();
    // Signing needs both required boxes and a signature.
    await client.getByLabel("Type my name").check();
    expect(await client.getByRole("button", { name: "Sign and approve" }).isDisabled()).toBe(true);
    await client.getByLabel(/Required: I agree to do business electronically/).check();
    await client.getByLabel(/Required: I confirm the page above is accurate/).check();
    await client.getByRole("button", { name: "Sign and approve" }).click();
    await client.getByText(/You signed and approved this case study/).waitFor();
    expect(await status(studyId)).toBe("approved");

    // The same link now looks like any other bad link.
    expect((await client.goto(link))?.status()).toBe(404);

    // The owner publishes it.
    await page.reload();
    await page.getByLabel("Page address").waitFor();
    await page.getByLabel("Page address").fill("faster-onboarding");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await page.getByRole("button", { name: "Unpublish" }).waitFor();
    const { data } = await stack.admin.from("case_studies").select("status, slug").eq("id", studyId).single();
    expect(data).toEqual({ status: "published", slug: "faster-onboarding" });
  }, 120_000);

  it("shows the owner what the client asked to change, and the old link stops working", async () => {
    const owner = await createUser(stack.admin, "ap-changes");
    const studyId = await seed(owner.id);
    const page = await ownerPage(owner.email, owner.password, studyId);
    const link = await requestLink(page);

    const client = await newPage(stack);
    await openVerifiedSigningLink(client, stack, link.split("/sign/")[1]);
    await client.goto(link);
    await client.getByRole("button", { name: "Request changes" }).click();
    await client.getByLabel(/What should change\?/).fill("Please <b>remove</b> the second section");
    await client.getByRole("button", { name: "Send to the team" }).click();
    await client.getByText(/We sent your note to the team/).waitFor();
    expect(await status(studyId)).toBe("draft");

    await page.reload();
    const note = page.getByTestId("client-note");
    await note.waitFor();
    // Shown as text, never as markup.
    expect(await note.textContent()).toBe("Please <b>remove</b> the second section");
    expect((await client.goto(link))?.status()).toBe(404);
  }, 120_000);

  it("a declined study can never be published", async () => {
    const owner = await createUser(stack.admin, "ap-decline");
    const studyId = await seed(owner.id);
    const page = await ownerPage(owner.email, owner.password, studyId);
    const link = await requestLink(page);

    const client = await newPage(stack);
    await openVerifiedSigningLink(client, stack, link.split("/sign/")[1]);
    await client.goto(link);
    await client.getByRole("button", { name: "Decline and remove" }).click();
    await client.getByRole("button", { name: "Yes, decline" }).click();
    await client.getByText(/will not be published/).waitFor();

    await page.reload();
    await page.getByText("The client declined this case study").first().waitFor();
    expect(await page.getByRole("button", { name: "Publish", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Request client approval and signature" }).count()).toBe(0);
    const forced = await stack.admin.from("case_studies").update({ status: "published", slug: "forced" }).eq("id", studyId);
    expect(forced.error?.message).toContain("publish_blocked");
  }, 120_000);

  it("rejects tokens that were never issued", async () => {
    const page = await newPage(stack);
    expect((await page.goto(`${BASE}/approve/${randomBytes(32).toString("base64url")}`))?.status()).toBe(404);
    expect((await page.goto(`${BASE}/sign/${randomBytes(32).toString("base64url")}`))?.status()).toBe(404);
    expect((await page.goto(`${BASE}/sign/not-a-token`))?.status()).toBe(404);
    // The old link shape forwards, and a bad one still ends at "not found".
    expect((await page.goto(`${BASE}/approve/not-a-token`))?.status()).toBe(200);
  }, 60_000);
});

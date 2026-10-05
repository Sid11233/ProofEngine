import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { BASE, createUser, newPage, signIn, startStack, stopStack, watchConsole, type Stack } from "./harness";

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

const MESSAGE = "We cut onboarding time by 40 percent in March. <img src=x onerror=\"document.title='pwned'\"> Support tickets fell from 1,200 to 300.";
const QUOTE = "cut onboarding time by 40 percent";

async function seed(userId: string, { withStudy = true } = {}) {
  const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", userId).single();
  const ws = String(member?.workspace_id);
  await stack.admin.from("workspaces").update({ plan: "team" }).eq("id", ws);
  const { data: request } = await stack.admin.from("proof_requests").insert({
    workspace_id: ws, client_name: "Dana Doe", client_email: "d@example.test", flow_type: "agency",
    token_hash: createHash("sha256").update(randomBytes(8)).digest("hex"), expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: "completed",
  }).select("id").single();
  const { data: interview } = await stack.admin.from("interviews").insert({ request_id: request?.id, workspace_id: ws, status: "completed", consent_given: true, question_index: 6 }).select("id").single();
  const { data: message } = await stack.admin.from("interview_messages").insert({ interview_id: interview?.id, workspace_id: ws, role: "client", content: MESSAGE }).select("id").single();
  if (!withStudy) return { ws, studyId: "", claimId: "", interviewId: String(interview?.id), requestId: String(request?.id) };
  const { data: study } = await stack.admin.from("case_studies").insert({ workspace_id: ws, interview_id: interview?.id, content: {}, status: "draft" }).select("id").single();
  const { data: claim } = await stack.admin.from("claims").insert({ case_study_id: study?.id, workspace_id: ws, text: "Onboarding fell 40 percent", source_message_id: message?.id, source_quote: QUOTE, client_confirmed: true }).select("id").single();
  const content = {
    headline: "Faster onboarding",
    client: { name: "Dana" },
    sections: [
      { type: "results", title: "Results", body: "Onboarding got much faster.", metrics: [{ label: "Onboarding time cut", value: "40 percent", claimId: claim?.id }] },
      { type: "quote", title: "In their words", quote: { text: "We cut onboarding time", attribution: "Dana", claimId: claim?.id } },
    ],
    tags: ["onboarding"],
  };
  await stack.admin.from("case_studies").update({ content }).eq("id", study?.id);
  await stack.admin.from("case_study_versions").insert({ case_study_id: study?.id, workspace_id: ws, version: 1, content });
  return { ws, studyId: String(study?.id), claimId: String(claim?.id), interviewId: String(interview?.id), requestId: String(request?.id) };
}

describe("the review screen", () => {
  it("shows sources, flags edited numbers, and saves a new version that revokes the client's confirmation", async () => {
    const owner = await createUser(stack.admin, "cs-owner");
    const s = await seed(owner.id);
    const page = await newPage(stack);
    const problems = watchConsole(page);
    await signIn(page, owner.email, owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);

    await page.goto(`${BASE}/app/case-studies/${s.studyId}/review`);
    await page.getByText("Numbers must match what your client said.").waitFor();
    expect(await page.getByLabel("Headline").inputValue()).toBe("Faster onboarding");

    // The source shows the client's exact words with the quote highlighted, and markup stays text.
    await page.getByText("Source for Onboarding time cut").click();
    await page.locator("mark", { hasText: QUOTE }).first().waitFor();
    await page.getByText(/<img src=x onerror/).first().waitFor();
    expect(await page.locator("details img").count()).toBe(0);
    expect(await page.title()).not.toBe("pwned");
    expect(await page.getByText(/Edited:/).count()).toBe(0);

    // Changing a number flags it immediately; Save is only enabled once something changed.
    expect(await page.getByRole("button", { name: "Save changes" }).isDisabled()).toBe(true);
    await page.getByLabel("Value").fill("45 percent");
    await page.getByText(/Edited: this no longer matches what your client said/).first().waitFor();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByText(/Saved as version 2/).waitFor();
    await page.getByText(/1 edited item/).waitFor();

    const { data: claim } = await stack.admin.from("claims").select("edited, client_confirmed").eq("id", s.claimId).single();
    expect(claim).toEqual({ edited: true, client_confirmed: false });
    const { data: study } = await stack.admin.from("case_studies").select("current_version, status").eq("id", s.studyId).single();
    expect(study).toEqual({ current_version: 2, status: "draft" });
    const { data: versions } = await stack.admin.from("case_study_versions").select("version").eq("case_study_id", s.studyId);
    expect(versions?.map((v) => v.version).sort()).toEqual([1, 2]);

    // After a reload the item is still flagged; putting the real number back clears it.
    await page.reload();
    await page.getByText(/Edited: this no longer matches/).first().waitFor();
    await page.getByLabel("Value").fill("40 percent");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByText(/Saved as version 3/).waitFor();
    expect(await page.getByText(/Edited:/).count()).toBe(0);

    // Markup typed into a field is refused by the server-side schema.
    await page.getByLabel("Headline").fill("<script>alert(1)</script>");
    await page.getByText("HTML is not allowed").waitFor();
    expect(await page.getByRole("button", { name: "Save changes" }).isDisabled()).toBe(true);

    expect(problems, `console problems: ${problems.join(" | ")}`).toEqual([]);
    await page.close();
  }, 120_000);

  it("is read-only for viewers and a 404 for other workspaces", async () => {
    const owner = await createUser(stack.admin, "cs-owner2");
    const s = await seed(owner.id);
    const viewer = await createUser(stack.admin, "cs-viewer", { withWorkspace: false });
    await stack.admin.from("workspace_members").insert({ workspace_id: s.ws, user_id: viewer.id, role: "viewer" });
    const stranger = await createUser(stack.admin, "cs-stranger");

    const v = await newPage(stack);
    await signIn(v, viewer.email, viewer.password);
    await v.waitForURL(`${BASE}/app/dashboard`);
    await v.goto(`${BASE}/app/case-studies/${s.studyId}/review`);
    await v.getByText("You can view this case study but not change it.").waitFor();
    expect(await v.getByLabel("Headline").isDisabled()).toBe(true);
    expect(await v.getByRole("button", { name: "Save changes" }).count()).toBe(0);
    await v.close();

    const o = await newPage(stack);
    await signIn(o, stranger.email, stranger.password);
    await o.waitForURL(`${BASE}/app/dashboard`);
    const res = await o.goto(`${BASE}/app/case-studies/${s.studyId}/review`);
    expect(res?.status()).toBe(404);
    expect(await o.content()).not.toContain("Faster onboarding");
    await o.close();
  }, 120_000);

  it("the request page offers generation for a completed interview, and the list shows the study", async () => {
    const owner = await createUser(stack.admin, "cs-owner3");
    const s = await seed(owner.id, { withStudy: false });
    const page = await newPage(stack);
    await signIn(page, owner.email, owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.goto(`${BASE}/app/requests/${s.requestId}`);
    await page.getByRole("button", { name: "Generate case study" }).waitFor();
    // This server has no AI key, so generation reports that clearly instead of failing silently.
    await page.getByRole("button", { name: "Generate case study" }).click();
    await page.getByText("AI is not configured on this server yet.").waitFor();
    await page.close();
  }, 120_000);
});

describe("POST /api/case-studies/generate", () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${BASE}/api/case-studies/generate`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("refuses requests that do not come from this app's own origin", async () => {
    expect((await post({ interviewId: crypto.randomUUID() })).status).toBe(403);
    expect((await post({ interviewId: crypto.randomUUID() }, { origin: "https://evil.example" })).status).toBe(403);
  });

  it("requires a signed-in editor, a valid body, and a configured AI", async () => {
    const origin = { origin: BASE };
    expect((await post({ interviewId: crypto.randomUUID() }, origin)).status).toBe(401);

    const viewer = await createUser(stack.admin, "cs-api-viewer", { withWorkspace: false });
    const owner = await createUser(stack.admin, "cs-api-owner");
    const s = await seed(owner.id);
    await stack.admin.from("workspace_members").insert({ workspace_id: s.ws, user_id: viewer.id, role: "viewer" });

    const page = await newPage(stack);
    await signIn(page, viewer.email, viewer.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    const asViewer = await page.request.post(`${BASE}/api/case-studies/generate`, { data: { interviewId: s.interviewId }, headers: origin });
    expect(asViewer.status()).toBe(403);
    await page.close();

    const editorPage = await newPage(stack);
    await signIn(editorPage, owner.email, owner.password);
    await editorPage.waitForURL(`${BASE}/app/dashboard`);
    expect((await editorPage.request.post(`${BASE}/api/case-studies/generate`, { data: { interviewId: "not-a-uuid" }, headers: origin })).status()).toBe(400);
    expect((await editorPage.request.post(`${BASE}/api/case-studies/generate`, { data: { interviewId: s.interviewId, extra: 1 }, headers: origin })).status()).toBe(400);
    expect((await editorPage.request.post(`${BASE}/api/case-studies/generate`, { data: { interviewId: s.interviewId }, headers: origin })).status()).toBe(503);
    await editorPage.close();
  }, 120_000);
});

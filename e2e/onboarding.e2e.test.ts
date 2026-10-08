import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, createUser, newPage, signIn, startStack, stopStack, watchConsole, type Stack } from "./harness";

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 120_000);
afterAll(async () => {
  await stopStack(stack);
});

const LONG = "We run a small roofing company with about twelve people and we mostly serve homeowners across the region every year";

describe("client onboarding", () => {
  it("the owner edits the questions, sends an onboarding link, the client answers it, and the owner reads the answers", async () => {
    const owner = await createUser(stack.admin, "ob-e2e");
    const page = await newPage(stack);
    const problems = watchConsole(page);
    await signIn(page, owner.email, owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);

    // the CMS: cut the standard list down to two questions, make the second a short one, save
    await page.goto(`${BASE}/app/onboarding/questions`);
    await page.getByLabel("Question 1 text").waitFor();
    for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Remove question 3" }).click();
    await page.getByLabel("Question 1 text").fill("What does your company do and for whom?");
    await page.getByLabel("Question 2 text").fill("Please paste your website and social links.");
    await page.getByRole("checkbox").nth(1).check();
    await page.getByRole("button", { name: "Save questions" }).click();
    await page.getByText(/Saved\. New onboarding links use these questions/).waitFor();
    const { data: flows } = await stack.admin.from("question_flows").select("questions, purpose").eq("purpose", "onboarding").not("workspace_id", "is", null);
    expect(flows).toHaveLength(1);
    expect((flows![0].questions as Array<{ text: string; key?: string }>).map((q) => [q.text, q.key])).toEqual([["What does your company do and for whom?", undefined], ["Please paste your website and social links.", "short"]]);

    // an empty question is refused by the server
    await page.getByLabel("Question 2 text").fill("");
    await page.getByRole("button", { name: "Save questions" }).click();
    await page.getByText(/at least 3 characters/).waitFor();
    await page.getByLabel("Question 2 text").fill("Please paste your website and social links.");
    await page.getByRole("button", { name: "Save questions" }).click();
    await page.getByText(/Saved\./).waitFor();

    // create the onboarding link
    await page.goto(`${BASE}/app/onboarding/new`);
    await page.getByLabel("Contact name").fill("Dana Doe");
    await page.getByLabel("Contact email").fill("dana@example.test");
    await page.getByRole("button", { name: "Create onboarding" }).click();
    const link = await page.getByLabel("Interview link").inputValue();
    expect(link).toMatch(/\/i\/[A-Za-z0-9_-]{43}$/);
    const { data: request } = await stack.admin.from("proof_requests").select("id, purpose, status").eq("client_email", "dana@example.test").single();
    expect(request).toMatchObject({ purpose: "onboarding" });
    await stack.admin.from("proof_requests").update({ status: "sent" }).eq("id", request!.id);

    // the client
    const client = await stack.browser.newContext({ viewport: { width: 390, height: 800 }, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.91" } });
    const phone = await client.newPage();
    await phone.goto(link);
    await phone.getByRole("heading", { name: "Hi Dana" }).waitFor();
    await phone.getByText(/looking forward to working with you/).waitFor();
    await phone.getByText(/2 short questions/).waitFor();
    expect(await phone.getByText(/case study/i).count()).toBe(0);
    await phone.getByRole("checkbox").check();
    await phone.getByRole("button", { name: "Start the interview" }).click();
    await phone.getByText("Question 1 of 2").waitFor();
    expect(await phone.getByRole("group", { name: "Sentence starters" }).count()).toBe(0); // starters are for reviews only
    await phone.getByLabel("Your answer").fill(`${LONG} <b>bold</b>`);
    await phone.getByRole("button", { name: "Send" }).click();
    await phone.getByText("Question 2 of 2").waitFor();
    await phone.getByLabel("Your answer").fill("https://roofing.example.test");
    await phone.getByRole("button", { name: "Send" }).click(); // a short question: no follow-up, straight to the end
    await phone.getByText(/That is everything I wanted to ask/).waitFor();
    await phone.getByRole("button", { name: "Continue" }).click();
    await phone.getByRole("heading", { name: "Almost done" }).waitFor();
    expect(await phone.getByText("how may they credit you").count()).toBe(0);
    expect(await phone.getByText("Know someone who might want").count()).toBe(0);
    await phone.getByRole("button", { name: "Finish" }).click();
    await phone.getByRole("heading", { name: "Thank you, Dana!" }).waitFor();
    const { data: done } = await stack.admin.from("interviews").select("status, publish_permission, consent_text_version").eq("request_id", request!.id).single();
    expect(done).toMatchObject({ status: "completed", consent_text_version: "onboarding-2026-10-v1" });

    // the owner reads the answers as text; there is no case study route for them
    await page.goto(`${BASE}/app/requests/${request!.id}`);
    await page.getByRole("heading", { name: "Onboarding answers" }).waitFor();
    const answers = page.getByTestId("onboarding-answer");
    expect(await answers.first().textContent()).toBe(`${LONG} <b>bold</b>`);
    expect(await answers.first().locator("b").count()).toBe(0);
    expect(await page.getByText("Open the case study").count()).toBe(0);
    expect(await page.getByRole("button", { name: /Generate/ }).count()).toBe(0);
    await page.goto(`${BASE}/app/onboarding`);
    await page.getByRole("link", { name: "Dana Doe" }).waitFor();
    expect(problems.filter((p) => !/401|403|404/.test(p))).toEqual([]);
    await client.close();
  }, 240_000);

  it("another workspace sees neither the questions nor the request", async () => {
    const a = await createUser(stack.admin, "ob-a");
    const b = await createUser(stack.admin, "ob-b");
    const pa = await newPage(stack);
    await signIn(pa, a.email, a.password);
    await pa.waitForURL(`${BASE}/app/dashboard`);
    await pa.goto(`${BASE}/app/onboarding/new`);
    await pa.getByLabel("Contact name").fill("Only A");
    await pa.getByLabel("Contact email").fill("only-a@example.test");
    await pa.getByRole("button", { name: "Create onboarding" }).click();
    await pa.getByLabel("Interview link").waitFor();
    const { data: req } = await stack.admin.from("proof_requests").select("id").eq("client_email", "only-a@example.test").single();
    const pb = await newPage(stack);
    await signIn(pb, b.email, b.password);
    await pb.waitForURL(`${BASE}/app/dashboard`);
    expect((await pb.goto(`${BASE}/app/requests/${req!.id}`))?.status()).toBe(404);
    await pb.goto(`${BASE}/app/onboarding`);
    expect(await pb.getByText("Only A").count()).toBe(0);
  }, 180_000);
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, createUser, newPage, signIn, startStack, stopStack, watchConsole, type Stack } from "./harness";

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 120_000);
afterAll(async () => {
  await stopStack(stack);
});

describe("clients and projects", () => {
  it("an owner adds a client, a project, a link and feedback; text stays text; other workspaces cannot see it", async () => {
    const owner = await createUser(stack.admin, "cl-owner");
    const other = await createUser(stack.admin, "cl-other");
    const page = await newPage(stack);
    const problems = watchConsole(page);
    await signIn(page, owner.email, owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);

    await page.goto(`${BASE}/app/clients`);
    await page.getByLabel("Client name").fill("Acme Roofing");
    await page.getByLabel("Contact email").fill("boss@acme.test");
    await page.getByLabel("Website").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Add client" }).click();
    await page.getByText("Enter a full https:// address").waitFor();
    await page.getByLabel("Website").fill("https://acme.test");
    await page.getByRole("button", { name: "Add client" }).click();
    await page.waitForURL(/\/app\/clients\/[0-9a-f-]{36}$/);
    const clientId = page.url().split("/").pop()!;

    await page.getByLabel("Project name").fill("Website rebuild");
    await page.getByLabel("Repository link").fill("https://evil.test/a/b");
    await page.getByRole("button", { name: "Add project" }).click();
    await page.getByText("Use a github.com, gitlab.com or bitbucket.org link").waitFor();
    await page.getByLabel("Repository link").fill("https://github.com/acme/site");
    await page.getByRole("button", { name: "Add project" }).click();
    await page.waitForURL(/\/app\/projects\/[0-9a-f-]{36}$/);
    const projectId = page.url().split("/").pop()!;

    await page.getByLabel("Label").fill("Staging");
    await page.getByRole("textbox", { name: /^Link/ }).fill("https://staging.acme.test");
    await page.getByRole("button", { name: "Add link" }).click();
    await page.getByText("Link added.").waitFor();
    const link = page.getByRole("link", { name: "https://staging.acme.test/" });
    expect(await link.getAttribute("rel")).toContain("noopener");
    expect(await link.getAttribute("target")).toBe("_blank");

    await page.getByLabel("What they said").fill("Loved it <b>so</b> much <img src=x onerror=alert(1)>");
    await page.getByRole("button", { name: "Add feedback" }).click();
    await page.getByText("Feedback added.").waitFor();
    const body = page.getByTestId("feedback-body").first();
    expect(await body.textContent()).toBe("Loved it <b>so</b> much <img src=x onerror=alert(1)>");
    expect(await body.locator("b, img").count()).toBe(0);

    // the list pages show it; a second workspace gets 404s
    await page.goto(`${BASE}/app/projects`);
    await page.getByText("Website rebuild").waitFor();
    const outsider = await newPage(stack);
    await signIn(outsider, other.email, other.password);
    await outsider.waitForURL(`${BASE}/app/dashboard`);
    expect((await outsider.goto(`${BASE}/app/clients/${clientId}`))?.status()).toBe(404);
    expect((await outsider.goto(`${BASE}/app/projects/${projectId}`))?.status()).toBe(404);

    // delete the project, then the client
    await page.goto(`${BASE}/app/projects/${projectId}`);
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Delete project" }).click();
    await page.waitForURL(`${BASE}/app/clients/${clientId}`);
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Delete client" }).click();
    await page.waitForURL(`${BASE}/app/clients`);
    expect((await stack.admin.from("clients").select("id").eq("id", clientId)).data).toHaveLength(0);
    expect(problems.filter((p) => !/401|403|404/.test(p))).toEqual([]);
  }, 180_000);
});

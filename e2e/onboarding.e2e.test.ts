import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { BASE, createUser, newPage, signIn, startStack, stopStack, watchConsole, type Stack } from "./harness";

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

describe("signup and onboarding in a real browser", () => {
  it("takes a new user from signup through onboarding to a working dashboard", async () => {
    const page = await newPage(stack);
    const problems = watchConsole(page);
    const email = `e2e-signup-${randomBytes(4).toString("hex")}@example.test`;

    await page.goto(`${BASE}/signup`);
    await page.getByLabel("Your name").fill("Ada Lovelace");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill("a-long-enough-password");
    await page.getByRole("button", { name: "Create account" }).click();

    // Local Supabase auto-confirms, so signup lands straight in onboarding.
    await page.waitForURL(`${BASE}/onboarding`);

    // Step 1 needs a choice.
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("Choose one").waitFor();
    await page.getByLabel(/^Agency/).check();
    await page.getByLabel("Business name").fill("Admin");
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 2: an insecure website is refused by the server and the wizard shows why.
    await page.getByLabel("Your niche").fill("AI automation for dentists");
    await page.getByLabel("Who you serve").fill("Dental practice owners");
    await page.getByLabel("Website (optional)").fill("http://insecure.example.com");
    await page.getByLabel("What do you sell, in one line?").fill("Chat assistants that book appointments.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByText(/public https:\/\//).waitFor();

    await page.getByLabel("Website (optional)").fill("https://acme.example.com");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Create workspace" }).click();

    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.getByRole("heading", { name: "Dashboard" }).waitFor();
    await page.getByText("Admin · owner").waitFor();

    // The reserved name "Admin" must not have become the subdomain.
    const { data: user } = await stack.admin.from("profiles").select("id").eq("email", email).single();
    const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", user?.id ?? "").single();
    const { data: workspace } = await stack.admin.from("workspaces").select("subdomain_slug, website, plan").eq("id", member?.workspace_id ?? "").single();
    // "admin-hq", or a suffixed variant if an earlier run already took it.
    expect(workspace?.subdomain_slug).toMatch(/^admin-hq(-[a-z0-9]{4})?$/);
    expect(workspace?.website).toBe("https://acme.example.com/");
    expect(workspace?.plan).toBe("free");

    // Onboarding is only for people without a workspace.
    await page.goto(`${BASE}/onboarding`);
    expect(new URL(page.url()).pathname).toBe("/app/dashboard");

    expect(problems, `console problems: ${problems.join(" | ")}`).toEqual([]);
    await page.close();
  });

  it("sends a signed-in user with no workspace from the app to onboarding", async () => {
    const user = await createUser(stack.admin, "no-ws", { withWorkspace: false });
    const page = await newPage(stack);
    await signIn(page, user.email, user.password);
    await page.waitForURL(`${BASE}/app/dashboard`).catch(() => undefined);
    await page.goto(`${BASE}/app/dashboard`);
    expect(new URL(page.url()).pathname).toBe("/onboarding");
    await page.close();
  });

  it("rejects a weak signup password with a field error and no account", async () => {
    const page = await newPage(stack);
    const email = `e2e-weak-${randomBytes(4).toString("hex")}@example.test`;
    await page.goto(`${BASE}/signup`);
    await page.getByLabel("Your name").fill("Weak Pass");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByText("Use at least 12 characters").waitFor();
    const { data } = await stack.admin.from("profiles").select("id").eq("email", email);
    expect(data ?? []).toHaveLength(0);
    await page.close();
  });
});

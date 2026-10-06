import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { BASE, createUser, newPage, signIn, startStack, stopStack, watchConsole, type Stack } from "./harness";

let stack: Stack;

beforeAll(async () => {
  stack = await startStack({ REAUTH_MAX_AGE_SECONDS: "600" });
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

const workspaceIdOf = async (userId: string) =>
  String((await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", userId).single()).data?.workspace_id);

describe("team management in a real browser", () => {
  it("an owner invites a new person who signs up through the link, joins, and is then manageable", async () => {
    const owner = await createUser(stack.admin, "team-owner");
    const ownerPage = await newPage(stack);
    const problems = watchConsole(ownerPage);
    await signIn(ownerPage, owner.email, owner.password);
    await ownerPage.waitForURL(`${BASE}/app/dashboard`);

    await ownerPage.getByRole("link", { name: "Team" }).click();
    await ownerPage.getByRole("heading", { name: "Team", exact: true }).waitFor();

    // Invalid input is refused with a field error.
    const inviteeEmail = `e2e-invitee-${randomBytes(4).toString("hex")}@example.test`;
    await ownerPage.getByLabel("Email").fill("not-an-email");
    await ownerPage.getByRole("button", { name: "Send invitation" }).click();
    await ownerPage.getByText("Enter a valid email address").waitFor();

    await ownerPage.getByLabel("Email").fill(inviteeEmail);
    await ownerPage.getByLabel("Role").selectOption("editor");
    await ownerPage.getByRole("button", { name: "Send invitation" }).click();
    const link = await ownerPage.getByLabel("Invite link").inputValue();
    expect(link).toMatch(new RegExp(`^${BASE}/invite/[A-Za-z0-9_-]{43}$`));
    await ownerPage.getByText(inviteeEmail).waitFor();

    // A duplicate is refused.
    await ownerPage.getByLabel("Email").fill(inviteeEmail);
    await ownerPage.getByRole("button", { name: "Send invitation" }).click();
    await ownerPage.getByText(/already on the team or has a pending invitation/).waitFor();

    // The invitee has no account: the link leads to login, then signup, and comes back to the invite.
    const guest = await newPage(stack);
    await guest.goto(link);
    expect(new URL(guest.url()).pathname).toBe("/login");
    await guest.getByRole("link", { name: "Create an account" }).click();
    await guest.getByLabel("Your name").fill("New Teammate");
    await guest.getByLabel("Work email").fill(inviteeEmail);
    await guest.getByLabel("Password").fill("a-long-enough-password");
    await guest.getByRole("button", { name: "Create account" }).click();
    await guest.waitForURL(link);
    await guest.getByRole("heading", { name: /Join E2E team-owner/ }).waitFor();
    await guest.getByText("editor", { exact: true }).waitFor();
    await guest.getByRole("button", { name: "Accept invitation" }).click();
    await guest.waitForURL(`${BASE}/app/dashboard`);
    await guest.locator("header").getByText(/E2E team-owner/).waitFor();

    // The link is now spent.
    await guest.goto(link);
    await guest.getByRole("heading", { name: "This invitation cannot be used" }).waitFor();

    // The new editor sees the team but no admin controls.
    await guest.goto(`${BASE}/app/settings/team`);
    await guest.getByText("Only admins and owners can invite people or change roles.").waitFor();
    expect(await guest.getByRole("button", { name: "Send invitation" }).count()).toBe(0);
    expect(await guest.getByRole("button", { name: "Remove" }).count()).toBe(0);

    // The owner changes the role, then removes the member; the member loses access.
    await ownerPage.reload();
    await ownerPage.getByLabel("Role for New Teammate").selectOption("viewer");
    await ownerPage.getByText("Role updated.").waitFor();
    await ownerPage.getByRole("button", { name: "Remove" }).click();
    await ownerPage.getByText("Member removed.").waitFor();
    await guest.goto(`${BASE}/app/dashboard`);
    await guest.waitForURL(`${BASE}/onboarding`);

    // Everything above was recorded.
    const ws = await workspaceIdOf(owner.id);
    const actions = ((await stack.admin.from("audit_log").select("action").eq("workspace_id", ws)).data ?? []).map((r) => r.action);
    for (const expected of ["invite.create", "invite.accept", "member.role_change", "member.remove"]) {
      expect(actions, `audit_log is missing ${expected}`).toContain(expected);
    }

    expect(problems, `console problems: ${problems.join(" | ")}`).toEqual([]);
    await ownerPage.close();
    await guest.close();
  }, 120_000);

  it("an invite cannot be accepted by a different signed-in account, and the page does not say why", async () => {
    const owner = await createUser(stack.admin, "team-owner2");
    const stranger = await createUser(stack.admin, "team-stranger");
    const page = await newPage(stack);
    await signIn(page, owner.email, owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.goto(`${BASE}/app/settings/team`);
    await page.getByLabel("Email").fill(`someone-else-${randomBytes(3).toString("hex")}@example.test`);
    await page.getByRole("button", { name: "Send invitation" }).click();
    const link = await page.getByLabel("Invite link").inputValue();
    await page.close();

    const other = await newPage(stack);
    await signIn(other, stranger.email, stranger.password);
    await other.waitForURL(`${BASE}/app/dashboard`);
    await other.goto(link);
    await other.getByRole("heading", { name: "This invitation cannot be used" }).waitFor();
    await other.close();
  }, 120_000);

  it("removing a member needs a recent sign-in", async () => {
    // Separate server with a 3 second recent-sign-in window.
    await stopStack(stack);
    stack = await startStack({ REAUTH_MAX_AGE_SECONDS: "3" });

    const owner = await createUser(stack.admin, "team-reauth");
    const member = await createUser(stack.admin, "team-reauth-m", { withWorkspace: false });
    await stack.admin.from("workspace_members").insert({ workspace_id: await workspaceIdOf(owner.id), user_id: member.id, role: "viewer" });

    const page = await newPage(stack);
    await signIn(page, owner.email, owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.goto(`${BASE}/app/settings/team`);
    await page.waitForTimeout(4000);

    await page.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("group", { name: "Confirm it is you" }).waitFor();
    await page.getByLabel("Password").fill("wrong-password-here");
    await page.getByRole("button", { name: "Confirm" }).click();
    await page.getByText("Incorrect password.").waitFor();
    expect(await workspaceIdOf(member.id), "member removed without re-authentication").toBeTruthy();

    await page.getByLabel("Password").fill(owner.password);
    await page.getByRole("button", { name: "Confirm" }).click();
    await page.getByText("Member removed.").waitFor();
    const { data } = await stack.admin.from("workspace_members").select("user_id").eq("user_id", member.id);
    expect(data ?? []).toHaveLength(0);
    await page.close();
  }, 120_000);
});

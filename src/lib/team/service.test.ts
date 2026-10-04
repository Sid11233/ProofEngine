import { describe, expect, it } from "vitest";
import { buildInviteLink, classify, TEAM_ERROR_MESSAGES } from "./service";
import { changeRoleSchema, inviteSchema, removeMemberSchema } from "./schemas";

describe("classify", () => {
  it.each([
    ["42501", "forbidden"],
    ["28000", "forbidden"],
    ["23505", "conflict"],
    ["54000", "limit"],
    ["P0002", "not_found"],
    ["22023", "invalid"],
    ["23514", "invalid"],
    ["XX000", "failed"],
  ])("maps database error %s to %s", (code, expected) => {
    expect(classify({ code })).toBe(expected);
  });

  it("never exposes database wording in the user-facing messages", () => {
    for (const message of Object.values(TEAM_ERROR_MESSAGES)) expect(message).not.toMatch(/postgres|sql|violat|constraint/i);
  });
});

describe("buildInviteLink", () => {
  it("builds an absolute link on the app origin", () => {
    expect(buildInviteLink("https://app.example.com", "abc123")).toBe("https://app.example.com/invite/abc123");
  });

  it("cannot be redirected to another host by the token value", () => {
    expect(new URL(buildInviteLink("https://app.example.com", "//evil.com")).origin).toBe("https://app.example.com");
  });
});

describe("team schemas", () => {
  it("normalises invite emails and rejects the owner role", () => {
    expect(inviteSchema.parse({ email: " New@Example.COM ", role: "editor" })).toEqual({ email: "new@example.com", role: "editor" });
    expect(inviteSchema.safeParse({ email: "a@example.com", role: "owner" }).success).toBe(false);
    expect(inviteSchema.safeParse({ email: "a@example.com", role: "editor", workspaceId: "x" }).success).toBe(false);
  });

  it("requires uuids for member operations", () => {
    expect(removeMemberSchema.safeParse({ userId: "not-a-uuid" }).success).toBe(false);
    expect(changeRoleSchema.safeParse({ userId: crypto.randomUUID(), role: "superadmin" }).success).toBe(false);
    expect(changeRoleSchema.safeParse({ userId: crypto.randomUUID(), role: "owner" }).success).toBe(true);
  });
});

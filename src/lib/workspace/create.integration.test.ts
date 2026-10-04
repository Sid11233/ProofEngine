/**
 * Runs the real creation flow against a LOCAL Supabase (npm run test:isolation).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, loadLocalConfig, makeClient, type TestUser } from "../../../supabase/tests/isolation/harness";
import { createWorkspaceWithProfile, WorkspaceLimitError } from "./create";
import type { OnboardingInput } from "./schemas";
import { isValidSlug } from "./slug";

let admin: SupabaseClient;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;
const users: string[] = [];

const profile = (overrides: Partial<OnboardingInput> = {}): OnboardingInput => ({
  type: "agency",
  name: "Acme Agency",
  niche: "AI automation for dentists",
  audience: "Dental practice owners",
  website: "https://acme.com/",
  description: "We build chat assistants.",
  ...overrides,
});

async function workspaceIdsOf(user: TestUser): Promise<string[]> {
  const { data } = await user.client.from("workspace_members").select("workspace_id");
  return (data ?? []).map((row) => String(row.workspace_id));
}

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  [alice, bob, carol] = await Promise.all(["onb-a", "onb-b", "onb-c"].map((l) => createTestUser(cfg, admin, l)));
  users.push(alice.id, bob.id, carol.id);
}, 60_000);

afterAll(async () => {
  for (const user of [alice, bob, carol]) {
    for (const id of await workspaceIdsOf(user)) await admin.from("workspaces").delete().eq("id", id);
  }
  for (const id of users) await admin.auth.admin.deleteUser(id);
});

describe("createWorkspaceWithProfile", () => {
  it("creates the workspace, stores the profile and slug, and makes the caller the owner", async () => {
    const { id, slug } = await createWorkspaceWithProfile(alice.client, profile({ name: "Alice Studio" }));

    expect(isValidSlug(slug)).toBe(true);
    const { data: row } = await admin.from("workspaces").select("*").eq("id", id).single();
    expect(row).toMatchObject({
      name: "Alice Studio",
      type: "agency",
      niche: "AI automation for dentists",
      audience: "Dental practice owners",
      website: "https://acme.com/",
      description: "We build chat assistants.",
      subdomain_slug: slug,
      plan: "free",
    });

    const { data: member } = await admin.from("workspace_members").select("role").eq("workspace_id", id).eq("user_id", alice.id).single();
    expect(member?.role).toBe("owner");
  });

  it("gives two workspaces with the same name different slugs", async () => {
    const first = await createWorkspaceWithProfile(bob.client, profile({ name: "Twin Studio" }));
    const second = await createWorkspaceWithProfile(carol.client, profile({ name: "Twin Studio" }));
    expect(first.slug).toBe("twin-studio");
    expect(second.slug).not.toBe(first.slug);
    expect(second.slug.startsWith("twin-studio-")).toBe(true);
    expect(isValidSlug(second.slug)).toBe(true);
  });

  it.each(["Admin", "ＡＰＩ", "www", "Billing"])("never lets the name %j claim a reserved slug", async (name) => {
    const { slug } = await createWorkspaceWithProfile(carol.client, profile({ name }));
    expect(isValidSlug(slug)).toBe(true);
  });

  it("stores no website when none is given", async () => {
    const { id } = await createWorkspaceWithProfile(bob.client, profile({ name: "No Site Co", website: undefined }));
    const { data } = await admin.from("workspaces").select("website").eq("id", id).single();
    expect(data?.website).toBeNull();
  });

  it("deletes the half-built workspace when no slug can be saved", async () => {
    const before = (await workspaceIdsOf(bob)).length;
    await expect(
      createWorkspaceWithProfile(bob.client, profile({ name: "Doomed Co" }), ["twin-studio"]),
    ).rejects.toThrow();
    expect((await workspaceIdsOf(bob)).length, "a workspace was left behind").toBe(before);
  });

  it("deletes the half-built workspace on a non-slug failure too", async () => {
    const before = (await workspaceIdsOf(bob)).length;
    // An invalid slug trips the database check constraint rather than the unique index.
    await expect(
      createWorkspaceWithProfile(bob.client, profile({ name: "Bad Slug Co" }), ["Not Valid!"]),
    ).rejects.toThrow();
    expect((await workspaceIdsOf(bob)).length, "a workspace was left behind").toBe(before);
  });

  it("stops at the per-user workspace cap", async () => {
    const dave = await createTestUser(loadLocalConfig(), admin, "onb-cap");
    users.push(dave.id);
    for (let i = 1; i <= 5; i++) await createWorkspaceWithProfile(dave.client, profile({ name: `Cap Co ${i}` }));
    await expect(createWorkspaceWithProfile(dave.client, profile({ name: "Cap Co 6" }))).rejects.toBeInstanceOf(
      WorkspaceLimitError,
    );
    for (const id of await workspaceIdsOf(dave)) await admin.from("workspaces").delete().eq("id", id);
  });
});

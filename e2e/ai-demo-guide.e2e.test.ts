import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, createUser, newPage, signIn, startStack, stopStack, watchConsole, type Stack } from "./harness";
import { EXAMPLE_JSON } from "../src/lib/demos/ai-prompt";

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 120_000);
afterAll(async () => {
  await stopStack(stack);
});

describe("build a demo with your own AI", () => {
  it("the guide shows a request for the project; pasted steps are imported, checked, and saved", async () => {
    const owner = await createUser(stack.admin, "aid-owner");
    const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", owner.id).single();
    const ws = String(member?.workspace_id);
    const { data: client } = await stack.admin.from("clients").insert({ workspace_id: ws, created_by: owner.id, name: "Roofing Co" }).select("id").single();
    const { data: project } = await stack.admin.from("projects").insert({ workspace_id: ws, client_id: client?.id, created_by: owner.id, name: "Booking site", summary: "Online booking for roofers.", repo_url: "https://github.com/acme/booking" }).select("id").single();
    const { data: demo } = await stack.admin.from("demos").insert({ workspace_id: ws, created_by: owner.id, title: "Import demo", content: { scenes: [] } }).select("id").single();

    const page = await newPage(stack);
    const problems = watchConsole(page);
    await signIn(page, owner.email, owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);

    await page.goto(`${BASE}/app/projects/${project?.id}`);
    await page.getByRole("link", { name: "Build a demo with your AI" }).click();
    await page.getByRole("heading", { name: "Build a demo with your own AI" }).waitFor();
    const prompt = await page.getByLabel("The request to paste into your assistant").inputValue();
    expect(prompt).toContain("- Name: Booking site");
    expect(prompt).toContain("https://github.com/acme/booking");
    expect(prompt).toContain("Output ONLY one JSON object");
    await page.getByText("claude mcp list").first().waitFor();
    await page.getByText("@modelcontextprotocol/server-filesystem").first().waitFor();

    await page.goto(`${BASE}/app/demos/${demo?.id}`);
    await page.getByText("Paste what your assistant wrote").click();
    await page.getByLabel("Pasted steps").fill("not json at all");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByText(/could not find JSON/).waitFor();
    await page.getByLabel("Pasted steps").fill(EXAMPLE_JSON.replace("Open the Bookings tab.", "<img src=x onerror=alert(1)>"));
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByText(/HTML is not allowed/).waitFor();

    await page.getByLabel("Pasted steps").fill("Here you go:\n```json\n" + EXAMPLE_JSON + "\n```");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByText("2 steps added below. Read them before you publish.").waitFor();
    await page.getByText("Saved", { exact: true }).waitFor({ timeout: 15_000 });
    const { data: saved } = await stack.admin.from("demos").select("content").eq("id", demo?.id).single();
    const scenes = (saved?.content as { scenes: Array<{ type: string; id: string }> }).scenes;
    expect(scenes.map((s) => s.type)).toEqual(["chat", "workflow"]);
    expect(await page.getByText("Simulated example").first().isVisible()).toBe(true);
    expect(problems.filter((p) => !/401|403|404/.test(p))).toEqual([]);
  }, 180_000);
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import type { Page } from "playwright";
import { BASE, PORT, createUser, newPage, signIn, startStack, stopStack, type Stack } from "./harness";

// Pre-launch checklist: "Manual XSS test (10 payloads) on testimonials, names and metrics", automated.
// Every stored field is filled with a hostile payload straight in the database (so no input validation
// helps), then every page that shows it is opened. Nothing may run, and nothing may become an element.

const PAYLOADS = [
  "<script>window.__xss=1</script>",
  "<img src=x onerror=window.__xss=1>",
  '"><svg onload=window.__xss=1>',
  "javascript:window.__xss=1",
  "' onmouseover='window.__xss=1' x='",
  "</title><script>window.__xss=1</script>",
  "{{constructor.constructor('window.__xss=1')()}}",
  "${window.__xss=1}",
  '<iframe srcdoc="<script>parent.__xss=1</script>"></iframe>',
  '<a href="javascript:window.__xss=1">click</a>',
];
// The case study schema refuses markup-like text outright; these pass it, so the renderer itself is tested.
const SCHEMA_SAFE = PAYLOADS.filter((p) => !/[<>]/.test(p));

let stack: Stack;
beforeAll(async () => {
  stack = await startStack({ PUBLIC_SITES_DOMAIN: `localhost:${PORT}` });
}, 120_000);
afterAll(async () => {
  await stopStack(stack);
});

async function watch(page: Page) {
  const dialogs: string[] = [];
  page.on("dialog", async (d) => {
    dialogs.push(d.message());
    await d.dismiss();
  });
  await page.addInitScript(() => {
    (window as unknown as { __xss?: number }).__xss = undefined;
  });
  return dialogs;
}

async function expectInert(page: Page, dialogs: string[], where: string) {
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), `${where}: a payload ran`).toBeUndefined();
  expect(dialogs, `${where}: a dialog opened`).toEqual([]);
  // No element carrying an event handler, framed document or javascript: link exists in the page body.
  const dangerous = await page.evaluate(() => {
    const bad: string[] = [];
    document.querySelectorAll("body *").forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (/^on/i.test(attr.name)) bad.push(`${el.tagName}[${attr.name}]`);
        if (["href", "src", "action", "formaction"].includes(attr.name) && /^\s*javascript:/i.test(attr.value)) bad.push(`${el.tagName}[${attr.name}=javascript:]`);
      }
      if (el.tagName === "IFRAME" && el.hasAttribute("srcdoc")) bad.push("IFRAME[srcdoc]");
    });
    return bad;
  });
  expect(dangerous, `${where}: dangerous attributes`).toEqual([]);
  // Page scripts all carry the page's CSP nonce: none was injected.
  const unnonced = await page.evaluate(() => Array.from(document.querySelectorAll("script")).filter((s) => !s.nonce && !s.src && s.type !== "application/json" && s.textContent?.includes("__xss")).length);
  expect(unnonced, `${where}: an injected inline script`).toBe(0);
}

describe("hostile text everywhere", () => {
  it("names, headlines, metrics, quotes and notes are text on every page that shows them", async () => {
    const owner = await createUser(stack.admin, "xss-owner");
    const { data: m } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", owner.id).single();
    const ws = String(m?.workspace_id);
    const workspace = `xss-${randomBytes(4).toString("hex")}`;
    await stack.admin.from("workspaces").update({ name: PAYLOADS[0], niche: PAYLOADS[1], audience: PAYLOADS[2], subdomain_slug: workspace, plan: "pro" }).eq("id", ws);

    // A request with a hostile client name, and an interview + referral with hostile names.
    const rawInterview = randomBytes(32).toString("base64url");
    const { data: request } = await stack.admin.from("proof_requests").insert({ workspace_id: ws, client_name: PAYLOADS[3], client_email: "x@example.test", project_type: PAYLOADS[4], flow_type: "agency", token_hash: createHash("sha256").update(rawInterview).digest("hex"), expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: "sent" }).select("id").single();
    await stack.admin.from("referrals").insert({ workspace_id: ws, referred_name: PAYLOADS[5], referred_contact: PAYLOADS[6] });

    // A completed interview with one client message, and a confirmed claim the metric and quote point at.
    const { data: interview } = await stack.admin.from("interviews").insert({ request_id: request?.id, workspace_id: ws, status: "completed", consent_given: true, consent_text_version: "v1", question_index: 6, publish_permission: "first_name" }).select("id").single();
    const { data: message } = await stack.admin.from("interview_messages").insert({ interview_id: interview?.id, workspace_id: ws, role: "client", content: "We cut onboarding time by 40 percent." }).select("id").single();

    // A case study full of schema-safe payloads, published, with a preview link and an approval link.
    const pick = (i: number) => SCHEMA_SAFE[i % SCHEMA_SAFE.length];
    const [p0, p1, p2, p3, p4] = [0, 1, 2, 3, 4].map(pick);
    const { data: draft } = await stack.admin.from("case_studies").insert({ workspace_id: ws, interview_id: interview?.id, content: {}, status: "draft" }).select("id").single();
    const id = String(draft?.id);
    const { data: claim } = await stack.admin.from("claims").insert({ case_study_id: id, workspace_id: ws, text: pick(1), source_message_id: message?.id, source_quote: "cut onboarding time by 40 percent", client_confirmed: true }).select("id").single();
    const content = {
      headline: p0,
      client: { name: p1 },
      sections: [
        { type: "challenge", title: p2, body: p3 },
        { type: "results", title: "Results", metrics: [{ label: p4, value: pick(5), claimId: claim?.id }] },
        { type: "quote", title: "Quote", quote: { text: p1, attribution: p2, claimId: claim?.id } },
      ],
      tags: [p3],
    };
    await stack.admin.from("case_studies").update({ content }).eq("id", id);
    await stack.admin.from("case_study_versions").insert({ case_study_id: id, workspace_id: ws, version: 1, content });
    const previewRaw = randomBytes(32).toString("base64url");
    await stack.admin.from("case_study_previews").insert({ case_study_id: id, workspace_id: ws, token_hash: createHash("sha256").update(previewRaw).digest("hex"), expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    await stack.admin.from("approvals").insert({ case_study_id: id, workspace_id: ws, version: 1, approver_email: "d@example.test", method: "email_link" });
    expect((await stack.admin.from("case_studies").update({ status: "published", slug: "hostile-story" }).eq("id", id)).error).toBeNull();
    await stack.admin.from("wall_settings").insert({ workspace_id: ws, enabled: true, allowed_origins: ["https://example.com"], layout: "grid", max_items: 6 });
    await stack.admin.from("workspace_communities").insert({ workspace_id: ws, community_id: "b0000000-0000-4000-8000-000000000001", status: "saved", notes: PAYLOADS.join(" ") });

    // The public page, the workspace home, the widget and a draft preview (unpublish first for the preview).
    const visitor = await newPage(stack);
    const visitorDialogs = await watch(visitor);
    for (const [label, url] of [
      ["public story", `http://${workspace}.localhost:${PORT}/hostile-story`],
      ["workspace home", `http://${workspace}.localhost:${PORT}/`],
      ["report page", `http://${workspace}.localhost:${PORT}/hostile-story/report`],
      ["wall widget", `http://${workspace}.localhost:${PORT}/embed`],
    ] as const) {
      await visitor.goto(url);
      await expectInert(visitor, visitorDialogs, label);
    }
    const story = await visitor.goto(`http://${workspace}.localhost:${PORT}/hostile-story`);
    expect(story?.status()).toBe(200);
    // The text itself is shown, literally.
    await visitor.getByText(SCHEMA_SAFE[3], { exact: false }).first().waitFor();

    await stack.admin.from("case_studies").update({ status: "unpublished" }).eq("id", id);
    await visitor.goto(`${BASE}/preview/${previewRaw}`);
    await expectInert(visitor, visitorDialogs, "preview");

    // The interview link (client name in the greeting) and the owner's screens.
    await visitor.goto(`${BASE}/i/${rawInterview}`);
    await expectInert(visitor, visitorDialogs, "interview");

    const page = await newPage(stack);
    const dialogs = await watch(page);
    await signIn(page, owner.email, owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    for (const path of ["/app/dashboard", "/app/requests", `/app/requests/${request?.id}`, "/app/referrals", "/app/finder", `/app/case-studies/${id}/edit`, `/app/case-studies/${id}/review`, "/app/settings/wall", "/app/billing", "/app/settings/team"]) {
      await page.goto(`${BASE}${path}`);
      await expectInert(page, dialogs, path);
    }
    // The workspace name is in every app header: shown as text.
    await page.goto(`${BASE}/app/dashboard`);
    expect(await page.locator("header").getByText(PAYLOADS[0], { exact: false }).count()).toBeGreaterThan(0);
  }, 240_000);
});

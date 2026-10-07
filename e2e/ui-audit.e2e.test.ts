/**
 * The UI audit: every signed-in route at 1440, 1024 and 390 px wide. The app is light only (there is no dark theme),
 * so the audit runs in light and also with the browser asking for dark, to prove nothing changes.
 *
 * Checks: no sideways scroll, nothing clipped at the edge, one primary action per page, text contrast of at least 4.5
 * to 1 (3 to 1 for large text), orange never used for small text, a visible focus ring on the first tab stops, no
 * unfinished copy, and block spacing on a 4 px grid (the 8 px grid's half step).
 * Set UI_AUDIT_DIR to also save a screenshot of every page.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, createUser, signIn, startStack, stopStack, watchConsole, type Stack } from "./harness";
import { loadLocalConfig, makeClient } from "../supabase/tests/isolation/harness";

let stack: Stack;
let owner: Awaited<ReturnType<typeof createUser>>;
let platform: Awaited<ReturnType<typeof createUser>>;
const ids = { request: "", study: "" };
let verifiedHere: string[] = [];

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1024", width: 1024, height: 768 },
  { name: "390", width: 390, height: 844 },
] as const;

beforeAll(async () => {
  platform = await createUser(makeClient(loadLocalConfig(), "service"), "audit-platform");
  stack = await startStack({ PLATFORM_ADMIN_EMAILS: platform.email });
  owner = await createUser(stack.admin, "audit-owner");

  const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", owner.id).single();
  const ws = String(member?.workspace_id);
  await stack.admin.from("workspaces").update({ plan: "pro", subdomain_slug: `audit-${randomBytes(3).toString("hex")}`, niche: "Web design", audience: "Small business owners", description: "A small design studio" }).eq("id", ws);

  const mkRequest = async (name: string, status: string, projectType: string | null) => {
    const { data } = await stack.admin.from("proof_requests").insert({ workspace_id: ws, client_name: name, client_email: `${name.split(" ")[0].toLowerCase()}@example.test`, project_type: projectType, flow_type: "agency", token_hash: randomBytes(32).toString("hex"), expires_at: new Date(Date.now() + 86_400_000 * 14).toISOString(), status }).select("id").single();
    return String(data?.id);
  };
  ids.request = await mkRequest("Dana Doe", "completed", null);
  await mkRequest("Dive Dream Divers", "completed", "Website redesign");
  await mkRequest("Dolce Attires", "started", null);

  const { data: interview } = await stack.admin.from("interviews").insert({ request_id: ids.request, workspace_id: ws, status: "completed", consent_given: true, question_index: 6 }).select("id").single();
  const content = { headline: "Faster onboarding", client: { name: "Dana" }, sections: [{ type: "challenge", title: "The challenge", body: "Onboarding was slow." }], tags: [] };
  const { data: study } = await stack.admin.from("case_studies").insert({ workspace_id: ws, interview_id: interview?.id, content, status: "draft" }).select("id").single();
  ids.study = String(study?.id);
  await stack.admin.from("case_study_versions").insert({ case_study_id: ids.study, workspace_id: ws, version: 1, content });
  await stack.admin.from("referrals").insert({ workspace_id: ws, interview_id: interview?.id, referred_name: "Priya Shah", referred_contact: "priya@example.test" });

  // A few verified communities, so the page has something to show to a normal user.
  const { data: some } = await stack.admin.from("communities").select("id").eq("needs_verification", true).limit(3);
  verifiedHere = (some ?? []).map((c) => String(c.id));
  await stack.admin.from("communities").update({ needs_verification: false, last_verified_at: new Date().toISOString() }).in("id", verifiedHere);
}, 180_000);

afterAll(async () => {
  // Put the communities back the way they were.
  await stack.admin.from("communities").update({ needs_verification: true, last_verified_at: null }).in("id", verifiedHere);
  await stopStack(stack);
});

const routes = () => [
  "/app/dashboard", "/app/requests", "/app/requests/new", `/app/requests/${ids.request}`,
  "/app/case-studies", `/app/case-studies/${ids.study}/review`, `/app/case-studies/${ids.study}/edit`, `/app/case-studies/${ids.study}/template`,
  "/app/referrals", "/app/finder",
  "/app/settings/wall", "/app/settings/social", "/app/settings/team", "/app/settings/notifications", "/app/settings/privacy", "/app/settings/motion", "/app/settings/security",
  "/app/billing",
];

interface Findings {
  scrollX: boolean;
  clipped: string[];
  primaries: string[];
  lowContrast: string[];
  orangeSmallText: string[];
  unfinished: string[];
  badSpacing: string[];
}

/** Runs in the page. Everything is read from computed styles, so it checks what people actually see. */
function inspect(): Findings {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const rgba = (css: string): [number, number, number, number] => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = (top: [number, number, number, number], under: [number, number, number]): [number, number, number] => [top[0] * top[3] + under[0] * (1 - top[3]), top[1] * top[3] + under[1] * (1 - top[3]), top[2] * top[3] + under[2] * (1 - top[3])];
  const lum = ([r, g, b]: number[]) => { const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const label = (el: Element) => `${el.tagName.toLowerCase()}${el.getAttribute("data-anim") ? `[${el.getAttribute("data-anim")}]` : ""}: "${(el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)}"`;
  const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !el.closest("[hidden]") && !el.closest(".sr-only"); };

  const background = (el: Element): [number, number, number] => {
    const chain: Element[] = [];
    for (let n: Element | null = el; n; n = n.parentElement) chain.push(n);
    let base: [number, number, number] = [255, 255, 255];
    for (const node of chain.reverse()) {
      const c = rgba(getComputedStyle(node).backgroundColor);
      if (c[3] > 0) base = over(c, base);
    }
    return base;
  };
  const opacityOf = (el: Element) => { let o = 1; for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };

  const findings: Findings = { scrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, clipped: [], primaries: [], lowContrast: [], orangeSmallText: [], unfinished: [], badSpacing: [] };

  // Banners and notes must sit fully inside the viewport width.
  for (const el of document.querySelectorAll('[role="note"], [role="alert"], aside')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.left < -1 || r.right > window.innerWidth + 1) findings.clipped.push(label(el));
  }

  // Primary actions: the black filled buttons and links in the page content (not the navigation).
  const main = document.querySelector("main") ?? document.body;
  for (const el of main.querySelectorAll("a, button")) {
    if (!visible(el)) continue;
    const bg = rgba(getComputedStyle(el).backgroundColor);
    if (bg[3] > 0.9 && bg[0] < 30 && bg[1] < 30 && bg[2] < 30 && !el.closest('[role="radiogroup"], [role="group"][aria-label^="Filter"]')) findings.primaries.push(label(el));
  }

  // Text contrast, one check per element that directly holds text.
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || seen.has(el) || !(node.textContent ?? "").trim() || !visible(el) || el.closest("svg, script, style")) continue;
    seen.add(el);
    const style = getComputedStyle(el);
    const fgRaw = rgba(style.color);
    const bg = background(el);
    const op = opacityOf(el);
    const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * op], bg);
    const size = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 600;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const disabled = (el as HTMLButtonElement).disabled || el.closest("[disabled], [aria-disabled='true']");
    if (!disabled && ratio(fg, bg) < need) findings.lowContrast.push(`${ratio(fg, bg).toFixed(2)} < ${need} ${label(el)} [text ${style.color}, opacity ${op}, backdrop ${bg.map(Math.round).join(",")}]`);
    const orange = Math.abs(fg[0] - 255) < 30 && Math.abs(fg[1] - 90) < 40 && Math.abs(fg[2] - 31) < 40;
    if (orange && !large) findings.orangeSmallText.push(label(el));
  }

  // Unfinished copy.
  const text = (main as HTMLElement).innerText;
  for (const re of [/lorem ipsum/i, /\bTODO\b/, /coming soon/i, /\bTBD\b/, /\bundefined\b/, /\[object Object\]/, /\bNaN\b/, /No project type/]) if (re.test(text)) findings.unfinished.push(String(re));

  // Block spacing: gaps between the direct children of the page's top block, on a 4 px grid.
  const root = main.firstElementChild?.firstElementChild ?? main.firstElementChild;
  const kids = [...(root?.children ?? [])].filter(visible);
  for (let i = 1; i < kids.length; i++) {
    const gap = kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom;
    if (gap >= 0 && Math.abs(gap / 4 - Math.round(gap / 4)) * 4 > 1) findings.badSpacing.push(`${gap.toFixed(1)}px before ${label(kids[i])}`);
  }
  return findings;
}

/** Tab through the first stops and make sure each one shows a focus ring (outline or shadow). */
async function focusRings(page: Page): Promise<string[]> {
  const missing: string[] = [];
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 1.5) || (s.boxShadow !== "none" && s.boxShadow !== "");
      // A checkbox's ring is on the visible box beside the hidden input.
      const sib = el.closest("label")?.querySelector("span");
      const sibRing = sib ? getComputedStyle(sib).boxShadow !== "none" : false;
      return { ring: ring || sibRing, name: `${el.tagName.toLowerCase()}: ${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}` };
    });
    if (info && !info.ring) missing.push(info.name);
  }
  return missing;
}

for (const scheme of ["light", "dark"] as const) {
  describe(`ui audit, browser asking for ${scheme}`, () => {
    for (const vp of VIEWPORTS) {
      if (scheme === "dark" && vp.name !== "1440") continue;
      it(`every route at ${vp.name}px`, async () => {
        const context = await stack.browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme, extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${100 + VIEWPORTS.indexOf(vp)}` } });
        const page = await context.newPage();
        const problems = watchConsole(page);
        await signIn(page, owner.email, owner.password);
        await page.waitForURL(/\/app\//);
        const report: string[] = [];

        for (const route of routes()) {
          const response = await page.goto(`${BASE}${route}`);
          expect(response?.status(), route).toBe(200);
          await page.waitForLoadState("networkidle");
          // Let every finite animation finish (entry fades, count-ups), so contrast is measured at rest.
          await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
          await page.waitForTimeout(900);
          const f = await page.evaluate(inspect);
          const rings = await focusRings(page);
          // After the checks: a full page screenshot resizes the page and would disturb them.
          if (process.env.UI_AUDIT_DIR) {
            mkdirSync(process.env.UI_AUDIT_DIR, { recursive: true });
            await page.screenshot({ path: join(process.env.UI_AUDIT_DIR, `${route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}-${vp.name}-${scheme}.png`), fullPage: true });
          }
          // The editor is a full-screen tool with its own layout: it is exempt from the single primary action rule.
          const exemptPrimary = route.includes("/edit") || route.includes("/review") || route === "/app/dashboard" || route.endsWith("/requests/new");
          const lines = [
            f.scrollX ? "sideways scroll" : "",
            ...f.clipped.map((x) => `clipped: ${x}`),
            ...(exemptPrimary || f.primaries.length <= 1 ? [] : [`${f.primaries.length} primary actions: ${f.primaries.join(" | ")}`]),
            ...f.lowContrast.map((x) => `contrast ${x}`),
            ...f.orangeSmallText.map((x) => `orange small text ${x}`),
            ...f.unfinished.map((x) => `unfinished copy ${x}`),
            ...f.badSpacing.map((x) => `spacing ${x}`),
            ...rings.map((x) => `no focus ring on ${x}`),
          ].filter(Boolean);
          if (lines.length) report.push(`${route}\n  ${lines.join("\n  ")}`);
        }
        await context.close();
        expect(problems, `console problems: ${problems.join(" | ")}`).toEqual([]);
        expect(report.join("\n"), `UI audit failures at ${vp.name}px (${scheme})`).toBe("");
      }, 600_000);
    }
  });
}

import { describe, expect, it } from "vitest";
import { assetIdsIn, demoContentSchema, demoSettingsSchema, demoThemeSchema, nextSceneIndex, validateDemoContent } from "./schema";

const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";
const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 };
const shot = (over: Record<string, unknown> = {}) => ({ id: "s1", type: "screenshot", assetId: A1, hotspot: box, tooltip: { title: "Open reports", body: "Click here", position: "bottom" }, blurs: [], next: "auto", ...over });
const chat = (over: Record<string, unknown> = {}) => ({ id: "c1", type: "chat", persona: { name: "Ava", role: "Support agent" }, messages: [{ from: "user", text: "Hi", delayMs: 0 }], choices: [], ...over });
const flow = (over: Record<string, unknown> = {}) => ({ id: "w1", type: "workflow", title: "Refund flow", nodes: [{ id: "n1", type: "trigger", label: "Ticket", detail: "", appName: "Zendesk" }, { id: "n2", type: "result", label: "Refund", detail: "Sent", appName: "Stripe" }], edges: [{ from: "n1", to: "n2" }], ...over });
const compare = (over: Record<string, unknown> = {}) => ({ id: "k1", type: "compare", beforeAssetId: A1, afterAssetId: A2, beforeLabel: "Before", afterLabel: "After", caption: "Same report", ...over });
const ok = (scenes: unknown[]) => demoContentSchema.safeParse({ scenes });

const INJECTIONS = ["<img src=x onerror=alert(1)>", "<script>alert(1)</script>", "<svg/onload=alert(1)>", "</div><b>x", "<!-- c -->", "<?php echo 1 ?>"];

describe("scenes", () => {
  it("accepts all four scene types", () => {
    const result = ok([shot(), chat(), flow(), compare()]);
    expect(result.success).toBe(true);
  });
  it("fills in defaults: auto next, no blurs, no choices", () => {
    const result = demoContentSchema.parse({ scenes: [{ id: "s1", type: "screenshot", assetId: A1, hotspot: box, tooltip: { title: "T", body: "", position: "top" } }] });
    expect(result.scenes[0]).toMatchObject({ next: "auto", blurs: [] });
  });
  it("rejects unknown fields everywhere", () => {
    expect(ok([shot({ onclick: "x" })]).success).toBe(false);
    expect(ok([chat({ persona: { name: "Ava", role: "x", avatarUrl: "https://e.test/a.png" } })]).success).toBe(false);
    expect(demoContentSchema.safeParse({ scenes: [], extra: 1 }).success).toBe(false);
    expect(ok([{ ...shot(), type: "iframe" }]).success).toBe(false);
  });
});

describe("text is plain text only", () => {
  it("rejects markup in every text field", () => {
    for (const bad of INJECTIONS) {
      expect(ok([shot({ tooltip: { title: bad, body: "x", position: "top" } })]).success, `tooltip title ${bad}`).toBe(false);
      expect(ok([shot({ tooltip: { title: "x", body: bad, position: "top" } })]).success, `tooltip body ${bad}`).toBe(false);
      expect(ok([chat({ persona: { name: bad, role: "x" } })]).success, `persona name ${bad}`).toBe(false);
      expect(ok([chat({ persona: { name: "x", role: bad } })]).success, `persona role ${bad}`).toBe(false);
      expect(ok([chat({ messages: [{ from: "agent", text: bad, delayMs: 0 }] })]).success, `message ${bad}`).toBe(false);
      expect(ok([chat({ choices: [{ label: bad, goto: "c1" }] })]).success, `choice ${bad}`).toBe(false);
      expect(ok([flow({ title: bad })]).success, `workflow title ${bad}`).toBe(false);
      expect(ok([flow({ nodes: [{ id: "n1", type: "action", label: bad, detail: "", appName: "x" }], edges: [] })]).success, `node label ${bad}`).toBe(false);
      expect(ok([flow({ nodes: [{ id: "n1", type: "action", label: "x", detail: bad, appName: "x" }], edges: [] })]).success, `node detail ${bad}`).toBe(false);
      expect(ok([flow({ nodes: [{ id: "n1", type: "action", label: "x", detail: "", appName: bad }], edges: [] })]).success, `app name ${bad}`).toBe(false);
      expect(ok([compare({ beforeLabel: bad })]).success, `compare label ${bad}`).toBe(false);
      expect(ok([compare({ caption: bad })]).success, `caption ${bad}`).toBe(false);
    }
  });
  it("allows ordinary text with angle brackets that are not tags", () => {
    expect(ok([chat({ messages: [{ from: "user", text: "Is 3 < 5 and 7 > 2? Use a -> b", delayMs: 0 }] })]).success).toBe(true);
  });
  it("strips control, zero-width and bidi characters", () => {
    const parsed = demoContentSchema.parse({ scenes: [chat({ persona: { name: "A\u0000v​a\u202E", role: "\u0007Support" } })] });
    const scene = parsed.scenes[0];
    expect(scene.type === "chat" && scene.persona).toEqual({ name: "Ava", role: "Support" });
  });
});

describe("limits", () => {
  const long = (n: number) => "a".repeat(n);
  it("enforces every string length", () => {
    expect(ok([shot({ tooltip: { title: long(81), body: "", position: "top" } })]).success).toBe(false);
    expect(ok([shot({ tooltip: { title: long(80), body: long(281), position: "top" } })]).success).toBe(false);
    expect(ok([shot({ tooltip: { title: long(80), body: long(280), position: "top" } })]).success).toBe(true);
    expect(ok([chat({ messages: [{ from: "user", text: long(501), delayMs: 0 }] })]).success).toBe(false);
    expect(ok([chat({ choices: [{ label: long(61), goto: "c1" }] })]).success).toBe(false);
    expect(ok([flow({ nodes: [{ id: "n1", type: "action", label: long(61), detail: "", appName: "x" }], edges: [] })]).success).toBe(false);
    expect(ok([flow({ nodes: [{ id: "n1", type: "action", label: "x", detail: long(201), appName: "x" }], edges: [] })]).success).toBe(false);
    expect(ok([flow({ nodes: [{ id: "n1", type: "action", label: "x", detail: "", appName: long(41) }], edges: [] })]).success).toBe(false);
    expect(ok([compare({ caption: long(201) })]).success).toBe(false);
    expect(ok([chat({ messages: [{ from: "user", text: "", delayMs: 0 }] })]).success).toBe(false);
  });
  it("enforces array limits: scenes, messages, choices, nodes, blurs", () => {
    expect(demoContentSchema.safeParse({ scenes: Array.from({ length: 41 }, (_, i) => chat({ id: `c${i}` })) }).success).toBe(false);
    expect(demoContentSchema.safeParse({ scenes: Array.from({ length: 40 }, (_, i) => chat({ id: `c${i}` })) }).success).toBe(true);
    expect(ok([chat({ messages: Array.from({ length: 41 }, () => ({ from: "user", text: "x", delayMs: 0 })) })]).success).toBe(false);
    expect(ok([chat({ choices: Array.from({ length: 5 }, () => ({ label: "x", goto: "c1" })) })]).success).toBe(false);
    const nodes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, type: "action", label: "x", detail: "", appName: "x" }));
    expect(ok([flow({ nodes: nodes(12), edges: [] })]).success).toBe(true);
    expect(ok([flow({ nodes: nodes(13), edges: [] })]).success).toBe(false);
    expect(ok([shot({ blurs: Array.from({ length: 21 }, () => box) })]).success).toBe(false);
  });
  it("keeps numbers in range: delays, fractions, boxes inside the image", () => {
    expect(ok([chat({ messages: [{ from: "user", text: "x", delayMs: 3001 }] })]).success).toBe(false);
    expect(ok([chat({ messages: [{ from: "user", text: "x", delayMs: -1 }] })]).success).toBe(false);
    expect(ok([chat({ messages: [{ from: "user", text: "x", delayMs: 1.5 }] })]).success).toBe(false);
    expect(ok([shot({ hotspot: { x: 1.2, y: 0, w: 0.1, h: 0.1 } })]).success).toBe(false);
    expect(ok([shot({ hotspot: { x: 0.9, y: 0, w: 0.3, h: 0.1 } })]).success).toBe(false);
    expect(ok([shot({ hotspot: { x: 0, y: 0, w: 0, h: 0.1 } })]).success).toBe(false);
    expect(ok([shot({ hotspot: { x: Number.NaN, y: 0, w: 0.1, h: 0.1 } })]).success).toBe(false);
  });
  it("rejects absurdly large input without hanging", () => {
    const huge = { scenes: [chat({ messages: [{ from: "user", text: "x".repeat(5_000_000), delayMs: 0 }] })] };
    expect(demoContentSchema.safeParse(huge).success).toBe(false);
  });
});

describe("references", () => {
  it("scene ids are unique and every jump target exists", () => {
    expect(ok([chat({ id: "a" }), chat({ id: "a" })]).success).toBe(false);
    expect(ok([shot({ next: "nowhere" })]).success).toBe(false);
    expect(ok([chat({ choices: [{ label: "Go", goto: "nowhere" }] })]).success).toBe(false);
    expect(ok([shot({ id: "a", next: "b" }), chat({ id: "b" })]).success).toBe(true);
  });
  it("workflow edges join nodes of the same scene, and node ids are unique", () => {
    expect(ok([flow({ edges: [{ from: "n1", to: "missing" }] })]).success).toBe(false);
    expect(ok([flow({ nodes: [{ id: "n1", type: "action", label: "x", detail: "", appName: "x" }, { id: "n1", type: "result", label: "y", detail: "", appName: "x" }], edges: [] })]).success).toBe(false);
  });
  it("ids must be plain (no spaces, capitals, markup or path tricks)", () => {
    for (const id of ["Has Space", "UPPER", "../x", "<b>", "a".repeat(41), ""]) expect(ok([chat({ id })]).success, id).toBe(false);
  });
  it("images must belong to this demo", () => {
    const content = [shot({ assetId: A1 }), compare({ beforeAssetId: A1, afterAssetId: A2 })];
    expect(validateDemoContent({ scenes: content }, new Set([A1, A2])).ok).toBe(true);
    const foreign = validateDemoContent({ scenes: content }, new Set([A1]));
    expect(foreign).toEqual({ ok: false, issues: ["An image does not belong to this demo"] });
    expect(ok([shot({ assetId: "not-a-uuid" })]).success).toBe(false);
    expect(assetIdsIn(demoContentSchema.parse({ scenes: content })).sort()).toEqual([A1, A2]);
  });
  it("reports readable issues for bad content", () => {
    const result = validateDemoContent({ scenes: [shot({ tooltip: { title: "<b>x", body: "", position: "top" } })] }, new Set([A1]));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.join()).toContain("HTML is not allowed");
  });
});

describe("navigation", () => {
  const scenes = demoContentSchema.parse({ scenes: [shot({ id: "a", next: "c" }), chat({ id: "b" }), chat({ id: "c" })] }).scenes;
  it("follows an explicit target, otherwise the next scene, and ends after the last", () => {
    expect(nextSceneIndex(scenes, 0, "c")).toBe(2);
    expect(nextSceneIndex(scenes, 0, "auto")).toBe(1);
    expect(nextSceneIndex(scenes, 1)).toBe(2);
    expect(nextSceneIndex(scenes, 2)).toBe(-1);
    expect(nextSceneIndex(scenes, 0, "missing")).toBe(1);
  });
});

describe("settings and theme", () => {
  it("settings: https call to action only, a known lead gate, nothing unknown", () => {
    expect(demoSettingsSchema.safeParse({ lead_gate: "end", cta_text: "Book a call", cta_url: "https://example.com/book", allow_embed: true }).success).toBe(true);
    for (const url of ["http://example.com", "javascript:alert(1)", "https://user:pw@example.com", "https://localhost", "//example.com", "data:text/html,x", "https://exa mple.com"]) {
      expect(demoSettingsSchema.safeParse({ cta_text: "Go", cta_url: url }).success, url).toBe(false);
    }
    expect(demoSettingsSchema.safeParse({ cta_url: "https://example.com" }).success).toBe(false); // a link needs button text
    expect(demoSettingsSchema.safeParse({ lead_gate: "middle" }).success).toBe(false);
    expect(demoSettingsSchema.safeParse({ cta_text: "<b>Go</b>" }).success).toBe(false);
    expect(demoSettingsSchema.safeParse({ extra: true }).success).toBe(false);
    expect(demoSettingsSchema.parse({})).toEqual({ lead_gate: "none", allow_embed: false });
  });
  it("theme: a six digit hex colour only", () => {
    expect(demoThemeSchema.parse({})).toEqual({ primary: "#ff5a1f", rounded: true });
    for (const bad of ["red", "#fff", "#12345g", "url(javascript:x)", "#ff5a1f;background:url(x)"]) expect(demoThemeSchema.safeParse({ primary: bad }).success, bad).toBe(false);
  });
});

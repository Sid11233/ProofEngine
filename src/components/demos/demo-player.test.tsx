import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { demoContentSchema, demoThemeSchema } from "@/lib/demos/schema";
import { DemoPlayer } from "./demo-player";

const A = "11111111-1111-4111-8111-111111111111";
const theme = demoThemeSchema.parse({});
const render = (scenes: unknown[]) =>
  renderToStaticMarkup(<DemoPlayer content={demoContentSchema.parse({ scenes })} theme={theme} assetSrc={(id) => `/api/demo-asset/${id}`} />);

const chat = (text: string) => ({ id: "c1", type: "chat", persona: { name: "Ava", role: "Agent" }, messages: [{ from: "agent", text, delayMs: 0 }], choices: [] });

describe("DemoPlayer", () => {
  it("always labels a chat as a simulated example", () => {
    expect(render([chat("Hello")])).toContain("Simulated example");
  });
  it("renders text as text: markup-like text is escaped, never live", () => {
    const html = render([chat("1 < 2 and <3 and a&b")]);
    expect(html).toContain("1 &lt; 2");
    expect(html).not.toMatch(/<script|onerror|<img[^>]+src="x/i);
  });
  it("has no input fields in any scene", () => {
    const html = render([
      chat("Hi"),
      { id: "s1", type: "screenshot", assetId: A, hotspot: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, tooltip: { title: "T", body: "B", position: "top" } },
      { id: "w1", type: "workflow", title: "W", nodes: [{ id: "n1", type: "trigger", label: "L", detail: "", appName: "" }], edges: [] },
    ]);
    expect(html).not.toMatch(/<(input|textarea|select|form|iframe|script)/i);
  });
  it("loads images only from the fixed asset route", () => {
    const html = render([{ id: "s1", type: "screenshot", assetId: A, hotspot: { x: 0, y: 0, w: 0.5, h: 0.5 }, tooltip: { title: "T", body: "", position: "top" } }]);
    expect(html).toContain(`src="/api/demo-asset/${A}"`);
  });
  it("shows an empty message for a demo without scenes", () => {
    expect(render([])).toContain("no steps yet");
  });
});

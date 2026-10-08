import { describe, expect, it, vi } from "vitest";
import { drawSlide, THEMES, wrapLines } from "./draw-slide";

const measure = (t: string) => t.length * 10;

describe("wrapLines", () => {
  it("wraps at word boundaries", () => {
    expect(wrapLines(measure, "one two three four", 90)).toEqual(["one two", "three", "four"]);
  });
  it("splits a word wider than the line", () => {
    expect(wrapLines(measure, "abcdefghij", 40)).toEqual(["abcd", "efgh", "ij"]);
  });
  it("keeps explicit line breaks and never returns nothing", () => {
    expect(wrapLines(measure, "a\nb", 100)).toEqual(["a", "b"]);
    expect(wrapLines(measure, "", 100)).toEqual([""]);
  });
});

describe("drawSlide", () => {
  const ctx = () => {
    const calls: string[] = [];
    const c = {
      fillRect: vi.fn(), measureText: (t: string) => ({ width: t.length * 10 }), fillText: vi.fn((t: string) => calls.push(t)),
      set fillStyle(_v: string) {}, set font(_v: string) {}, set textBaseline(_v: string) {}, set textAlign(_v: string) {},
    } as unknown as CanvasRenderingContext2D;
    return { c, calls };
  };
  it("draws text only as pixels: the brand, position, slide text and the attribution", () => {
    const { c, calls } = ctx();
    drawSlide(c, { width: 1080, height: 1350 }, { kind: "quote", heading: "", body: '"our phone rings"' }, { index: 1, total: 4, brand: "Acme", attribution: "Dana" }, THEMES[0]);
    const text = calls.join(" ");
    expect(text).toContain("Acme");
    expect(text).toContain("2 / 4");
    expect(text).toContain("our");
    expect(text).toContain("Dana");
    expect(text).toContain("Swipe");
    expect(c.fillRect).toHaveBeenCalledWith(0, 0, 1080, 1350);
  });
  it("the last slide has no swipe cue; every theme has readable contrast pairs defined", () => {
    const { c, calls } = ctx();
    drawSlide(c, { width: 1080, height: 1080 }, { kind: "cta", heading: "Talk to us", body: "" }, { index: 2, total: 3, brand: "Acme" }, THEMES[1]);
    expect(calls.join(" ")).not.toContain("Swipe");
    expect(THEMES.map((t) => t.id)).toEqual(["ink", "cream", "orange", "blue"]);
  });
});

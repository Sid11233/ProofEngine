import { describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "@/lib/case-study/theme";
import { effectiveTheme, parseTemplate } from "./model";

const row = {
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Classic",
  category: "general",
  tier: "free",
  sections: ["challenge", "results", "quote"],
  default_theme: { ...DEFAULT_THEME, layout: "classic" },
  active: true,
};

describe("parseTemplate", () => {
  it("turns a valid row into a template with a layout name and a plain theme", () => {
    const template = parseTemplate(row);
    expect(template).toMatchObject({ name: "Classic", tier: "free", layout: "classic", sectionTypes: ["challenge", "results", "quote"] });
    expect(template?.theme).toEqual(DEFAULT_THEME);
    expect(template?.theme).not.toHaveProperty("layout");
  });

  it.each([
    ["inactive", { active: false }],
    ["unknown tier", { tier: "platinum" }],
    ["unknown section type", { sections: ["challenge", "banner"] }],
    ["unknown layout", { default_theme: { ...DEFAULT_THEME, layout: "custom-html" } }],
    ["bad colour", { default_theme: { ...DEFAULT_THEME, primary: "red", layout: "classic" } }],
    ["extra theme key", { default_theme: { ...DEFAULT_THEME, layout: "classic", css: "x" } }],
    ["missing name", { name: "" }],
    ["bad id", { id: "not-a-uuid" }],
  ])("drops a row with %s", (_label, patch) => {
    expect(parseTemplate({ ...row, ...patch })).toBeNull();
  });

  it("drops non-objects", () => {
    for (const input of [null, undefined, "x", 5, []]) expect(parseTemplate(input)).toBeNull();
  });
});

describe("effectiveTheme", () => {
  const template = parseTemplate(row)!;

  it("starts from the template's defaults and applies valid overrides", () => {
    expect(effectiveTheme(template, {})).toEqual(template.theme);
    expect(effectiveTheme(template, null)).toEqual(template.theme);
    expect(effectiveTheme(template, { primary: "#ff0000", mode: "dark" })).toEqual({ ...template.theme, primary: "#ff0000", mode: "dark" });
  });

  it("falls back to the template theme when the saved one is invalid", () => {
    expect(effectiveTheme(template, { primary: "javascript:alert(1)" })).toEqual(template.theme);
    expect(effectiveTheme(template, { fontPair: "Comic Sans" })).toEqual(template.theme);
    expect(effectiveTheme(template, { css: "x" })).toEqual(template.theme);
    expect(effectiveTheme(template, "nope")).toEqual(template.theme);
  });
});

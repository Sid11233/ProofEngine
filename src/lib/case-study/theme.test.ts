import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, FONT_PAIRS, readableOn, templateThemeSchema, themeSchema, themeToCssVars } from "./theme";

describe("themeSchema", () => {
  it("accepts a valid theme", () => {
    expect(themeSchema.safeParse(DEFAULT_THEME).success).toBe(true);
  });

  it.each([
    "red",
    "#fff",
    "#12345",
    "#1234567",
    "1d4ed8",
    "#gggggg",
    "#1d4ed8; background: url(https://evil.example/x)",
    "#1d4ed8}</style><script>alert(1)</script>",
    "rgb(0,0,0)",
    "url(javascript:alert(1))",
    "var(--x)",
    "",
  ])("rejects the colour %j", (primary) => {
    expect(themeSchema.safeParse({ ...DEFAULT_THEME, primary }).success).toBe(false);
  });

  it("only allows the six font pairs", () => {
    expect(FONT_PAIRS).toHaveLength(6);
    for (const fontPair of FONT_PAIRS) expect(themeSchema.safeParse({ ...DEFAULT_THEME, fontPair }).success).toBe(true);
    for (const fontPair of ["Comic Sans", "inter; color:red", "https://fonts.example/x", "", "Inter"]) {
      expect(themeSchema.safeParse({ ...DEFAULT_THEME, fontPair }).success).toBe(false);
    }
  });

  it("only allows listed radius, spacing and mode values", () => {
    expect(themeSchema.safeParse({ ...DEFAULT_THEME, radius: "50px" }).success).toBe(false);
    expect(themeSchema.safeParse({ ...DEFAULT_THEME, spacing: "10rem" }).success).toBe(false);
    expect(themeSchema.safeParse({ ...DEFAULT_THEME, mode: "auto" }).success).toBe(false);
  });

  it("rejects unknown keys, so arbitrary CSS or URLs cannot be smuggled in", () => {
    for (const extra of [{ css: "body{display:none}" }, { backgroundImage: "https://evil.example/x.png" }, { customFont: "https://evil.example/f.woff" }, { layout: "classic" }]) {
      expect(themeSchema.safeParse({ ...DEFAULT_THEME, ...extra }).success).toBe(false);
    }
  });

  it("template themes also name a layout variant from the fixed list", () => {
    expect(templateThemeSchema.safeParse({ ...DEFAULT_THEME, layout: "timeline" }).success).toBe(true);
    expect(templateThemeSchema.safeParse({ ...DEFAULT_THEME, layout: "../../etc/passwd" }).success).toBe(false);
    expect(templateThemeSchema.safeParse(DEFAULT_THEME).success).toBe(false);
  });
});

describe("themeToCssVars", () => {
  it("only produces values from fixed maps and the checked colour", () => {
    const vars = themeToCssVars({ ...DEFAULT_THEME, primary: "#047857", radius: "xl", spacing: "spacious", mode: "dark" });
    expect(vars["--cs-primary"]).toBe("#047857");
    expect(vars["--cs-radius"]).toBe("22px");
    expect(vars["--cs-gap"]).toBe("3rem");
    expect(vars["--cs-bg"]).toBe("#0b1020");
    for (const value of Object.values(vars)) expect(value).toMatch(/^[#a-z0-9.()-]+$/i);
  });

  it("switches between light and dark palettes", () => {
    expect(themeToCssVars({ ...DEFAULT_THEME, mode: "light" })["--cs-bg"]).toBe("#ffffff");
    expect(themeToCssVars({ ...DEFAULT_THEME, mode: "dark" })["--cs-bg"]).not.toBe("#ffffff");
  });
});

describe("readableOn", () => {
  it.each([
    ["#ffffff", "#111827"],
    ["#fde047", "#111827"],
    ["#000000", "#ffffff"],
    ["#1d4ed8", "#ffffff"],
    ["#047857", "#ffffff"],
    ["#7c3aed", "#ffffff"],
  ])("text on %s is %s", (background, expected) => expect(readableOn(background)).toBe(expected));
});

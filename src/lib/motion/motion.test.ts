import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePreference, resolveReducedMotion } from "./preference";
import { MOTION_REGISTRY, registeredIds } from "./registry";
import { DURATION_MS, EASE, MAX_DURATION_MS, MAX_STAGGER_ITEMS, SPRING, staggerDelayMs } from "./tokens";
import { fadeOnly, fadeUp, instant, slideDirection } from "./variants";

const reference = readFileSync(join(process.cwd(), "docs/animation-reference.md"), "utf8");
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("tokens match the reference", () => {
  it("durations, easings and springs", () => {
    expect(DURATION_MS).toEqual({ instant: 90, micro: 140, standard: 260, emphasis: 480, onboarding: 800 });
    expect(EASE.standard).toEqual([0.22, 1, 0.36, 1]);
    expect(EASE.emphasized).toEqual([0.65, 0, 0.35, 1]);
    expect(EASE.accelerate).toEqual([0.55, 0, 0.85, 0.35]);
    expect(EASE.decelerate).toEqual([0.16, 1, 0.3, 1]);
    expect(SPRING).toEqual({ gentle: { stiffness: 120, damping: 20 }, default: { stiffness: 300, damping: 30 }, snappy: { stiffness: 500, damping: 35 }, bouncy: { stiffness: 400, damping: 18 } });
    for (const [name, value] of [["instant", 90], ["micro", 140], ["standard", 260], ["emphasis", 480]] as const) expect(css).toContain(`--motion-${name}: ${value}ms`);
    expect(css).toContain("--ease-standard: cubic-bezier(0.22, 1, 0.36, 1)");
  });
  it("nothing outside onboarding exceeds 600 ms", () => {
    for (const [name, ms] of Object.entries(DURATION_MS)) if (name !== "onboarding") expect(ms, name).toBeLessThanOrEqual(MAX_DURATION_MS);
  });
  it("staggers 40 ms per item and stops at the 8th", () => {
    expect([0, 1, 2].map(staggerDelayMs)).toEqual([0, 40, 80]);
    expect(staggerDelayMs(7)).toBe(280);
    expect(staggerDelayMs(8)).toBe(280);
    expect(staggerDelayMs(500)).toBe(280);
    expect(staggerDelayMs(-3)).toBe(0);
    expect(MAX_STAGGER_ITEMS).toBe(8);
  });
});

describe("variants animate only transform and opacity", () => {
  const allowed = new Set(["opacity", "x", "y", "scale", "rotate", "transition"]);
  const keys = (variant: unknown) => Object.keys(typeof variant === "function" ? (variant as (i: number) => object)(0) : (variant as object));
  it("every variant", () => {
    for (const set of [fadeUp, fadeOnly, instant, slideDirection(1), slideDirection(-1)]) {
      for (const variant of Object.values(set)) for (const key of keys(variant)) expect(allowed.has(key), key).toBe(true);
    }
  });
  it("the reduced fade has no movement", () => {
    for (const variant of Object.values(fadeOnly)) expect(Object.keys(variant).some((k) => ["x", "y", "scale"].includes(k))).toBe(false);
  });
});

describe("the reduced-motion decision", () => {
  it("the in-app setting overrides the device setting; with no choice the device decides", () => {
    expect(resolveReducedMotion(true, "system")).toBe(true);
    expect(resolveReducedMotion(false, "system")).toBe(false);
    expect(resolveReducedMotion(false, "reduce")).toBe(true);
    expect(resolveReducedMotion(true, "full")).toBe(false);
  });
  it("unknown cookie values mean follow the device", () => {
    expect(parsePreference("reduce")).toBe("reduce");
    expect(parsePreference("full")).toBe("full");
    for (const odd of [undefined, null, "", "yes", "REDUCE", "<script>"]) expect(parsePreference(odd)).toBe("system");
  });
});

describe("the registry", () => {
  it("has unique IDs that exist in the reference, and real files", () => {
    const ids = registeredIds();
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of MOTION_REGISTRY) {
      expect(entry.id).toMatch(/^(G|AI|F|C|S|M|ILL)-\d{2}$/);
      expect(reference, entry.id).toContain(`| ${entry.id} |`);
      expect(() => readFileSync(join(process.cwd(), entry.file)), entry.file).not.toThrow();
      expect(readFileSync(join(process.cwd(), entry.file), "utf8"), `${entry.file} tags data-anim`).toContain(`data-anim="${entry.id}"`);
    }
  });
});

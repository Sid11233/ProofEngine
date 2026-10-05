import { describe, expect, it } from "vitest";
import { decideMode, progressOf } from "./interviewer";

describe("decideMode", () => {
  const long = "word ".repeat(20).trim();

  it("probes a thin answer while the budget lasts, then moves on", () => {
    expect(decideMode("challenge", "It was slow.", 0)).toBe("probe");
    expect(decideMode("challenge", "It was slow.", 1)).toBe("probe");
    expect(decideMode("challenge", "It was slow.", 2)).toBe("advance");
  });

  it("moves on after a detailed answer", () => {
    expect(decideMode("challenge", long, 0)).toBe("advance");
  });

  it("asks for numbers on the results question when none were given", () => {
    const noNumbers = "we did a lot of things that made the whole team much happier and faster overall in daily work";
    expect(decideMode("results", noNumbers, 0)).toBe("probe");
    expect(decideMode("results", `${noNumbers} saving 12 hours weekly`, 0)).toBe("advance");
  });
});

describe("progressOf", () => {
  it("reports question x of total, capped at the total", () => {
    expect(progressOf(0, 6)).toEqual({ current: 1, total: 6 });
    expect(progressOf(5, 6)).toEqual({ current: 6, total: 6 });
    expect(progressOf(6, 6)).toEqual({ current: 6, total: 6 });
  });
});

import { describe, expect, it } from "vitest";
import { isPlausibleUnsubscribeToken, unsubscribePath } from "./unsubscribe-path";

describe("unsubscribePath (audit L3)", () => {
  it("always percent-encodes the token and only emits known results", () => {
    expect(unsubscribePath("abc.def-ghi_jkl", "done")).toBe("/unsubscribe/abc.def-ghi_jkl?result=done");
    const hostile = unsubscribePath("../../evil?x=1#y", "done");
    expect(hostile).toBe("/unsubscribe/..%2F..%2Fevil%3Fx%3D1%23y?result=done");
    expect(hostile.startsWith("/unsubscribe/")).toBe(true);
    expect(unsubscribePath("t", "<script>" as never)).toBe("/unsubscribe/t?result=invalid");
  });
  it("accepts only token-shaped strings", () => {
    const real = `${"1".repeat(8)}-1111-4111-8111-${"1".repeat(12)}.${"A".repeat(43)}`;
    expect(isPlausibleUnsubscribeToken(real)).toBe(true);
    for (const bad of ["", "short", `${real}/x`, `${real}?a=1`, `${real}\n`, "x".repeat(101), "../".repeat(20)]) expect(isPlausibleUnsubscribeToken(bad), JSON.stringify(bad)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { unsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";

const id = "123e4567-e89b-42d3-a456-426614174000";

describe("unsubscribe tokens", () => {
  it("round-trips and is stable", () => {
    const t = unsubscribeToken("secret-one", id);
    expect(t.startsWith(`${id}.`)).toBe(true);
    expect(unsubscribeToken("secret-one", id)).toBe(t);
    expect(verifyUnsubscribeToken("secret-one", t)).toBe(id);
  });
  it("rejects another secret, another id, tampering and malformed input", () => {
    const t = unsubscribeToken("secret-one", id);
    expect(verifyUnsubscribeToken("secret-two", t)).toBeNull();
    expect(verifyUnsubscribeToken("secret-one", t.replace(id, "123e4567-e89b-42d3-a456-426614174001"))).toBeNull();
    expect(verifyUnsubscribeToken("secret-one", t.slice(0, -2) + "xx")).toBeNull();
    for (const bad of ["", "abc", `${id}`, `${id}.`, `.${t.split(".")[1]}`, `${t}.extra`, "x".repeat(200), "not-a-uuid.abc"]) expect(verifyUnsubscribeToken("secret-one", bad), bad).toBeNull();
  });
});

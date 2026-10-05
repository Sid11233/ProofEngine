import { describe, expect, it } from "vitest";
import { isSameOrigin } from "./origin";

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });
const APP = "https://app.example.com";

describe("isSameOrigin", () => {
  it("accepts the app's own origin, or the host the request was sent to", () => {
    expect(isSameOrigin(req({ origin: "https://app.example.com" }), APP)).toBe(true);
    expect(isSameOrigin(req({ origin: "https://preview-1.vercel.app", host: "preview-1.vercel.app" }), APP)).toBe(true);
  });

  it.each([
    [{}],
    [{ origin: "" }],
    [{ origin: "null" }],
    [{ origin: "https://evil.example" }],
    [{ origin: "https://app.example.com.evil.example" }],
    [{ origin: "http://app.example.com" }],
    [{ origin: "https://evil.example", host: "app.example.com" }],
  ])("refuses %j", (headers) => {
    expect(isSameOrigin(req(headers), APP)).toBe(false);
  });
});

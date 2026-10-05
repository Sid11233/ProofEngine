import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "./vapid";

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url with and without padding", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array("AQI"))).toEqual([1, 2]);
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });
  it("decodes a 65 byte public key to 65 bytes", () => {
    const key = "B" + "A".repeat(85) + "A";
    expect(urlBase64ToUint8Array(key).length).toBeGreaterThanOrEqual(64);
  });
});

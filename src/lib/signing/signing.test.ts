import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { canonicalJson, contentHash } from "./canonical";
import { generateCode, hashCode, isWellFormedCode } from "./code";
import { changedFields } from "./changes";
import { cleanSignatureImage, MAX_SIGNATURE_BYTES } from "./signature-image";
import { signSchema } from "./schemas";
import type { CaseStudyContent } from "@/lib/case-study/schema";

describe("canonical json and the content hash", () => {
  it("is independent of key order and changes with every signed fact", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[1,{"y":2,"z":1}]},"b":1}');
    const base = { content: { headline: "H", a: 1 }, consentTextVersion: "v1", consent: { web: true, social: false, media: false }, signerName: "Dana Doe" };
    const hash = contentHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash({ ...base, content: { a: 1, headline: "H" } })).toBe(hash);
    for (const changed of [{ content: { headline: "H2", a: 1 } }, { consentTextVersion: "v2" }, { consent: { web: true, social: true, media: false } }, { signerName: "Dana Roe" }]) {
      expect(contentHash({ ...base, ...changed })).not.toBe(hash);
    }
  });
});

describe("codes", () => {
  it("are six digits, keyed and bound to the link", () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/);
    expect(isWellFormedCode("012345")).toBe(true);
    for (const bad of ["12345", "1234567", "12345a", " 12345", 123456, null]) expect(isWellFormedCode(bad)).toBe(false);
    expect(hashCode("s", "tokenA", "123456")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode("s", "tokenA", "123456")).not.toBe(hashCode("s", "tokenB", "123456"));
    expect(hashCode("s", "tokenA", "123456")).not.toBe(hashCode("t", "tokenA", "123456"));
  });
});

describe("signature images", () => {
  const png = (w = 100, h = 40) => sharp({ create: { width: w, height: h, channels: 4, background: "#fff" } }).png().withMetadata({ exif: { IFD0: { Copyright: "secret" } } }).toBuffer();
  it("accepts a PNG and re-encodes it without metadata", async () => {
    const result = await cleanSignatureImage(await png());
    expect(result.ok).toBe(true);
    if (result.ok) expect((await sharp(result.png).metadata()).exif).toBeUndefined();
  });
  it("rejects non-PNG bytes, oversize files, huge dimensions and garbage", async () => {
    expect(await cleanSignatureImage(await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).jpeg().toBuffer())).toEqual({ ok: false, reason: "not_png" });
    expect(await cleanSignatureImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toEqual({ ok: false, reason: "not_png" });
    expect(await cleanSignatureImage(Buffer.alloc(MAX_SIGNATURE_BYTES + 1, 1))).toEqual({ ok: false, reason: "too_large" });
    expect(await cleanSignatureImage(await png(1700, 10))).toEqual({ ok: false, reason: "invalid" });
    expect(await cleanSignatureImage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("not a real png")]))).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("what we changed from your words", () => {
  const content: CaseStudyContent = {
    headline: "Better headline",
    client: {},
    sections: [{ type: "results", title: "Results", metrics: [{ label: "Faster", value: "50 percent", claimId: "c1" }], quote: { text: "We loved it a lot", attribution: "A customer", claimId: "c2" } }],
    tags: [],
  };
  const claims = new Map([
    ["c1", { id: "c1", sourceQuote: "cut it by 40 percent", messageContent: "We cut it by 40 percent." }],
    ["c2", { id: "c2", sourceQuote: "We loved it", messageContent: "We loved it." }],
  ]);
  it("lists rewritten fields with their old wording, and edited numbers and quotes", () => {
    const result = changedFields(content, ["headline"], new Map([["headline", "Old headline"]]), claims);
    expect(result.map((r) => r.kind)).toEqual(["rewritten", "edited_quote", "edited_number"]);
    expect(result[0]).toMatchObject({ label: "Headline", before: "Old headline", after: "Better headline" });
    expect(result[2]).toMatchObject({ after: "50 percent" });
  });
  it("is empty when nothing differs", () => {
    expect(changedFields({ ...content, sections: [{ ...content.sections[0], metrics: [{ label: "Faster", value: "40 percent", claimId: "c1" }], quote: { text: "We loved it", attribution: "A customer", claimId: "c2" } }] }, [], new Map(), claims)).toEqual([]);
  });
});

describe("signSchema", () => {
  const ok = { signerName: "Dana Doe", displayChoice: "full", esignDisclosure: true, confirmAccuracy: true, consentSocial: false, consentMedia: false, method: "typed", expectedVersion: 1 };
  it("needs both required boxes, a name and a signature", () => {
    expect(signSchema.safeParse(ok).success).toBe(true);
    expect(signSchema.safeParse({ ...ok, esignDisclosure: false }).success).toBe(false);
    expect(signSchema.safeParse({ ...ok, confirmAccuracy: false }).success).toBe(false);
    expect(signSchema.safeParse({ ...ok, method: "drawn" }).success).toBe(false);
    expect(signSchema.safeParse({ ...ok, email: "x@y.test" }).success).toBe(false);
    expect(signSchema.safeParse({ ...ok, signerName: "D" }).success).toBe(false);
  });
});

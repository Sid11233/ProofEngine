import { describe, expect, it } from "vitest";
import { explainPublishBlockers, type PublishFacts } from "./publish-check";

const ready: PublishFacts = { status: "approved", templateAllowed: true, approvedCurrentVersion: true, allClaimsConfirmed: true };

describe("explainPublishBlockers", () => {
  it("has nothing to say when everything is in order", () => {
    expect(explainPublishBlockers(ready)).toEqual([]);
  });

  it("names each missing requirement", () => {
    expect(explainPublishBlockers({ ...ready, templateAllowed: false }).map((b) => b.code)).toEqual(["template_locked"]);
    expect(explainPublishBlockers({ ...ready, approvedCurrentVersion: false }).map((b) => b.code)).toEqual(["not_approved"]);
    expect(explainPublishBlockers({ ...ready, allClaimsConfirmed: false }).map((b) => b.code)).toEqual(["claims_unconfirmed"]);
    expect(explainPublishBlockers({ ...ready, status: "published" }).map((b) => b.code)).toEqual(["invalid_state"]);
  });

  it("reports everything at once for a fresh draft on a free plan using a paid template", () => {
    const codes = explainPublishBlockers({ status: "draft", templateAllowed: false, approvedCurrentVersion: false, allClaimsConfirmed: false }).map((b) => b.code);
    expect(codes).toEqual(["template_locked", "not_approved", "claims_unconfirmed"]);
  });
});

import { describe, expect, it } from "vitest";
import { approvalEmail } from "./approval-service";

describe("approvalEmail", () => {
  const base = { clientName: "Dana Doe", workspaceName: "Acme", link: "https://app.example.com/approve/abc" };
  it("offers the client a way to delete everything, when a removal link is given", () => {
    const m = approvalEmail({ ...base, removalLink: "https://app.example.com/remove/xyz" });
    expect(m.text).toContain("https://app.example.com/approve/abc");
    expect(m.text).toContain("delete the story, your interview and your contact details at any time: https://app.example.com/remove/xyz");
  });
  it("is unchanged without one", () => {
    expect(approvalEmail(base).text).not.toContain("/remove/");
  });
});

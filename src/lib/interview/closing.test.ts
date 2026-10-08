import { describe, expect, it } from "vitest";
import { closingSchema, hasClosing } from "./closing";
import { finishSchema } from "./schemas";
import { ownerAlertEmail, thankYouEmail } from "./notify";

const token = "A".repeat(43);

describe("closing input", () => {
  it("empty fields are absent, text is cleaned", () => {
    const c = closingSchema.parse({ rating: 5, comment: "  Great​ team\u0000  ", email: "", phone: "", company: " Acme ", jobTitle: "" });
    expect(c).toEqual({ rating: 5, comment: "Great team", company: "Acme" });
    expect(hasClosing(c)).toBe(true);
    expect(hasClosing(closingSchema.parse({ email: "", comment: "" }))).toBe(false);
    expect(hasClosing(undefined)).toBe(false);
  });
  it("rejects bad ratings, emails, phones, oversize text and unknown fields", () => {
    for (const bad of [{ rating: 0 }, { rating: 6 }, { rating: 2.5 }, { email: "nope" }, { phone: "<script>" }, { phone: "abc" }, { comment: "x".repeat(1001) }, { company: "x".repeat(201) }, { role: "admin" }]) {
      expect(closingSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it("is optional on the finish request and strict inside it", () => {
    expect(finishSchema.safeParse({ token, publishPermission: "full" }).success).toBe(true);
    expect(finishSchema.safeParse({ token, publishPermission: "full", closing: { rating: 4 } }).success).toBe(true);
    expect(finishSchema.safeParse({ token, publishPermission: "full", closing: { rating: 4, x: 1 } }).success).toBe(false);
  });
});

describe("finish emails", () => {
  it("the thank-you carries the unsubscribe link and no answers", () => {
    const m = thankYouEmail({ firstName: "Dana", workspaceName: "Acme Studio", unsubscribe: "https://app.test/unsubscribe/abc" });
    expect(m.text).toContain("https://app.test/unsubscribe/abc");
    expect(m.text).toContain("Nothing is published until you have seen and approved");
  });
  it("the owner alert has a link and a rating, but no client names, answers or contact details", () => {
    const m = ownerAlertEmail({ workspaceName: "Acme Studio", rating: 4, link: "https://app.test/app/requests/1" });
    expect(m.text).toContain("4 out of 5");
    expect(m.text).toContain("https://app.test/app/requests/1");
    expect(ownerAlertEmail({ workspaceName: "A", link: "l" }).text).toContain("did not leave a rating");
  });
});

describe("notifyInterviewFinished", () => {
  it("mails the client only at the address on file and alerts the owners, with the unsubscribe link", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("@/lib/email/recipients", () => ({ workspaceAlertAddresses: async () => ["owner@agency.test"] }));
    const { notifyInterviewFinished } = await import("./notify");
    const rows: Record<string, Record<string, unknown>> = { proof_requests: { client_name: "Dana Doe", client_email: "dana@onfile.test" }, workspaces: { name: "Acme Studio" } };
    const admin = { from: (t: string) => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: rows[t] }) }), maybeSingle: async () => ({ data: rows[t] }) }) }) }) } as never;
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    await notifyInterviewFinished({ admin, sender: { send: async (m) => (sent.push(m), true) }, appUrl: "https://app.test", unsubscribeUrl: (id) => `https://app.test/unsubscribe/${id}` }, { requestId: "req-1", workspaceId: "ws-1" }, 5);
    expect(sent.map((m) => m.to)).toEqual(["dana@onfile.test", "owner@agency.test"]);
    expect(sent[0].text).toContain("Hi Dana,");
    expect(sent[0].text).toContain("https://app.test/unsubscribe/req-1");
    expect(sent[1].text).toContain("https://app.test/app/requests/req-1");
    expect(sent[1].text).not.toContain("dana@onfile.test");
    vi.doUnmock("@/lib/email/recipients");
  });
  it("does nothing when email is not configured", async () => {
    const { notifyInterviewFinished } = await import("./notify");
    await expect(notifyInterviewFinished({ admin: {} as never, sender: null, appUrl: "x", unsubscribeUrl: () => "" }, { requestId: "r", workspaceId: "w" })).resolves.toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { clientSchema, feedbackSchema, linkSchema, projectSchema } from "./schemas";

describe("clients and projects input", () => {
  it("treats empty optional fields as absent, trims and normalises", () => {
    const c = clientSchema.parse({ name: "  Acme  ", contact_email: "", website_url: "https://acme.com", notes: "" });
    expect(c).toEqual({ name: "Acme", website_url: "https://acme.com/", status: "active" });
  });
  it("rejects unknown fields and bad statuses", () => {
    expect(clientSchema.safeParse({ name: "A", role: "admin" }).success).toBe(false);
    expect(clientSchema.safeParse({ name: "A", status: "gone" }).success).toBe(false);
    expect(projectSchema.safeParse({ name: "P", workspace_id: "x" }).success).toBe(false);
  });
  it("links must be plain https addresses", () => {
    for (const bad of ["http://a.com", "javascript:alert(1)", "https://u:p@a.com", "https://localhost", "//a.com", "ftp://a.com", "a.com", "https://a b.com", "data:text/html,x"]) {
      expect(linkSchema.safeParse({ label: "x", url: bad }).success, bad).toBe(false);
    }
    expect(linkSchema.parse({ label: "Staging", url: "https://staging.acme.com/app?x=1#top", kind: "website" }).url).toBe("https://staging.acme.com/app?x=1#top");
  });
  it("repository links must be github, gitlab or bitbucket with a path", () => {
    expect(projectSchema.safeParse({ name: "P", repo_url: "https://github.com/acme/site" }).success).toBe(true);
    for (const bad of ["https://github.com", "https://evil.com/acme/site", "https://github.com.evil.com/a/b", "http://github.com/a/b"]) expect(projectSchema.safeParse({ name: "P", repo_url: bad }).success, bad).toBe(false);
  });
  it("dates must be real and ordered", () => {
    expect(projectSchema.safeParse({ name: "P", started_on: "2026-03-01", delivered_on: "2026-02-01" }).success).toBe(false);
    expect(projectSchema.safeParse({ name: "P", started_on: "2026-02-31" }).success).toBe(false);
    expect(projectSchema.safeParse({ name: "P", started_on: "2026-02-01", delivered_on: "2026-03-01" }).success).toBe(true);
  });
  it("text is bounded and stripped of control and invisible characters", () => {
    expect(feedbackSchema.parse({ body: "Great​ work\u0000!" }).body).toBe("Great work!");
    expect(feedbackSchema.safeParse({ body: "x".repeat(2001) }).success).toBe(false);
    expect(feedbackSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(projectSchema.safeParse({ name: "P", notes: "n".repeat(4001) }).success).toBe(false);
    expect(clientSchema.safeParse({ name: "x".repeat(201) }).success).toBe(false);
  });
});

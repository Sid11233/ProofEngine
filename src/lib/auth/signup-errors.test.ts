import { describe, expect, it } from "vitest";
import { describeSignupError } from "./signup-errors";

describe("describeSignupError", () => {
  it("explains the causes a person or the operator can act on", () => {
    expect(describeSignupError("weak_password")).toEqual({ message: "Choose a stronger password", field: "password" });
    expect(describeSignupError("email_address_invalid").field).toBe("email");
    expect(describeSignupError("over_email_send_rate_limit").message).toMatch(/wait/i);
    expect(describeSignupError("signup_disabled").message).toMatch(/not open/i);
    expect(describeSignupError("email_address_not_authorized").message).toMatch(/cannot send email/i);
  });
  it("falls back to a generic message for anything else, including unknown codes and none", () => {
    for (const code of ["unexpected_failure", "user_already_exists", "anything", undefined]) expect(describeSignupError(code).message).toMatch(/could not create your account/i);
  });
  it("never reveals whether an address already has an account", () => {
    for (const code of ["user_already_exists", "email_exists"]) expect(describeSignupError(code).message.toLowerCase()).not.toMatch(/already|exists|registered/);
  });
});

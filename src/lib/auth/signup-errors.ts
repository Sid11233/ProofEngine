// What to tell someone whose sign-up failed. Supabase reports WHY in an error code; showing only "could not
// create your account" hides fixable causes (a hit email limit, closed sign-ups). None of these reveal whether
// an email already has an account.

export interface SignupFailure {
  message: string;
  /** A field to flag instead of a general message. */
  field?: "email" | "password";
}

export function describeSignupError(code: string | undefined): SignupFailure {
  switch (code) {
    case "weak_password":
      return { message: "Choose a stronger password", field: "password" };
    case "email_address_invalid":
      return { message: "Enter a valid email address", field: "email" };
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return { message: "Too many sign-up emails have been sent. Please wait a while and try again." };
    case "signup_disabled":
    case "email_provider_disabled":
      return { message: "Sign-ups are not open right now. Please contact us if you expected to be able to join." };
    case "email_address_not_authorized":
      return { message: "We cannot send email to that address yet. Please try a different one or contact us." };
    default:
      return { message: "We could not create your account. Please try again in a few minutes." };
  }
}

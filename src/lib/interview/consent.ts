/**
 * Versioned consent shown on the interview intro screen. Change the text only by
 * adding a new version: the version a client agreed to is stored with the interview.
 */
export const CONSENT_VERSION = "2026-10-v1";

export const CONSENT_TEXT =
  "I agree that my answers may be used to write a case study about my experience. " +
  "Nothing will be published without my approval of the exact wording, and I can ask for it to be removed at any time.";

export const ONBOARDING_CONSENT_VERSION = "onboarding-2026-10-v1";

export const ONBOARDING_CONSENT_TEXT =
  "I agree that my answers will be shared with the business that sent me this link, so they can set up our work together. " +
  "They are not published, and I can ask for them to be deleted at any time.";

export type InterviewPurpose = "review" | "onboarding";

export const consentFor = (purpose: InterviewPurpose) =>
  purpose === "onboarding" ? { version: ONBOARDING_CONSENT_VERSION, text: ONBOARDING_CONSENT_TEXT } : { version: CONSENT_VERSION, text: CONSENT_TEXT };

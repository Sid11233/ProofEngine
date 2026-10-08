// Shared by the server and the browser recorder. No server-only imports here.

export const VOICE_BUCKET = "voice-notes";
export const MAX_VOICE_BYTES = 3 * 1024 * 1024;
export const MAX_VOICE_SECONDS = 120;
export const MAX_VOICES_PER_INTERVIEW = 12;
export const VOICE_RETENTION_DAYS = 30;

export const VOICE_CONSENT_VERSION = "voice-2026-10-v1";
export const VOICE_CONSENT_TEXT =
  "Your recording is sent to a speech-to-text service to write it out, and you can correct the text before you send it. " +
  "The business that sent you this link can listen to the recording for 30 days, then it is deleted. You can type your answer instead.";

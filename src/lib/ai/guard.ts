// Everything the model writes passes through here before a client sees it. The model
// is only ever allowed to produce a short acknowledgement or one follow-up question;
// anything else (links, emails, markup, numbers the client did not say, talk of its own
// instructions) is discarded and a canned line is used instead.

export type ReplyMode = "probe" | "advance";

const MAX_CHARS = 320;
const NUMBER = /\d+(?:[.,]\d+)*/g;
const URL_LIKE = /https?:|www\.|\b[a-z0-9-]+\.(?:com|io|net|org|co|ai|app|dev|xyz|ly|me)\b/i;
const EMAIL_LIKE = /\S+@\S+/;
const LEAKS = /system prompt|my instructions|ignore (?:all |the )?previous|as an ai|client_answer|i am programmed/i;

const numbersIn = (text: string) => new Set((text.match(NUMBER) ?? []).map((n) => n.replace(/[.,]+$/, "")));

/** Returns the cleaned text, or null if it must not be shown. */
export function validateModelText(raw: string, clientAnswer: string, mode: ReplyMode): string | null {
  const text = raw.replace(/\s+/g, " ").replace(/^["'“]+|["'”]+$/g, "").trim();
  if (text.length === 0 || text.length > MAX_CHARS) return null;
  if (/[<>`]/.test(text) || /[*_#]{2,}|^\s*[-*]\s/.test(text)) return null; // markup
  if (URL_LIKE.test(text) || EMAIL_LIKE.test(text) || LEAKS.test(text)) return null;

  // Never suggest numbers: every figure must already be in the client's own answer.
  const allowed = numbersIn(clientAnswer);
  for (const n of numbersIn(text)) if (!allowed.has(n)) return null;
  if (/[$€£]/.test(text) && !/[$€£]/.test(clientAnswer)) return null;

  const questions = (text.match(/\?/g) ?? []).length;
  // The next question is appended by the server, so an acknowledgement must not ask anything.
  if (mode === "advance" && questions > 0) return null;
  // A probe is exactly one question.
  if (mode === "probe" && (questions !== 1 || !text.endsWith("?"))) return null;
  return text;
}

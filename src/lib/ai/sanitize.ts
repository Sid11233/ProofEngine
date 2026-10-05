export const MAX_ANSWER_CHARS = 1000;

// Control characters (except tab and newline), zero-width and bidi override characters.
const INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const TAG_LIKE = /<\/?\s*[a-zA-Z][^>]*>?/g;

/** What is stored and shown: the client's own words, minus invisible and control characters. */
export function normalizeAnswer(input: string): string {
  return input.replace(/\r\n?/g, "\n").replace(INVISIBLE, "").trim();
}

/**
 * What the model sees. Tag-like sequences are removed repeatedly (so nested
 * "<cl<client_answer>ient_answer>" cannot reassemble), and any leftover angle brackets
 * are replaced, so client text can never open or close the <client_answer> wrapper.
 */
export function sanitizeForModel(input: string): string {
  let text = normalizeAnswer(input);
  for (let i = 0; i < 10; i++) {
    const next = text.replace(TAG_LIKE, "");
    if (next === text) break;
    text = next;
  }
  return text.replaceAll("<", "‹").replaceAll(">", "›").trim();
}

export function wrapClientAnswer(input: string): string {
  return `<client_answer>\n${sanitizeForModel(input)}\n</client_answer>`;
}

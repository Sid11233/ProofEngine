import { z } from "zod";

// Control characters (except tab/newline handled by trim), zero-width and bidi override characters.
// They have no place in names or short descriptions, and can be used to forge extra lines in plain
// text emails (CR/LF) or to visually spoof text (bidi overrides).
const INVISIBLE = /[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** One line of plain text: invisible and control characters removed, whitespace collapsed. */
export const cleanLine = (value: string) => value.replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();

/** A required or optional single-line text field with a maximum length. */
export const plainLine = (max: number, { min = 0 }: { min?: number } = {}, message?: string) =>
  z
    .string()
    .transform(cleanLine)
    .pipe(z.string().min(min, message).max(max, `Keep it under ${max} characters`));

import type { DemoContent, Rect } from "./schema";

// Redaction helpers. There is no OCR: the owner confirms every image themselves, and text typed into a demo
// is checked with patterns. These checks warn, they do not prove a demo is clean.

export type FindingKind = "email" | "phone" | "card" | "secret" | "ip";

const PATTERNS: Array<[FindingKind, RegExp]> = [
  ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/],
  ["secret", /\b(?:sk|pk|rk)[-_](?:live|test|or|ant)?[-_]?[A-Za-z0-9]{16,}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bxox[abp]-[A-Za-z0-9-]{10,}\b/],
  ["ip", /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/],
  ["phone", /(?<![\d.])\+?\d[\d\s().-]{8,16}\d(?![\d.])/],
];

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Kinds of personal or secret data that `text` appears to contain. */
export function findSensitive(text: string): FindingKind[] {
  const found = new Set<FindingKind>();
  for (const [kind, re] of PATTERNS) if (re.test(text)) found.add(kind);
  for (const m of text.matchAll(/(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g)) {
    if (luhn(m[0].replace(/\D/g, ""))) found.add("card");
  }
  // A phone pattern also matches card numbers and long ids; keep it only when it is not a card.
  if (found.has("card")) found.delete("phone");
  return [...found];
}

export interface TextFinding { path: string; kinds: FindingKind[] }

/** Every text field in a demo that looks like it holds personal data, by path. Reports kinds, never the text. */
export function scanDemoText(content: DemoContent): TextFinding[] {
  const out: TextFinding[] = [];
  const check = (path: string, text: string | undefined) => {
    if (!text) return;
    const kinds = findSensitive(text);
    if (kinds.length > 0) out.push({ path, kinds });
  };
  content.scenes.forEach((s, i) => {
    const at = `scenes.${i}`;
    if (s.type === "screenshot") { check(`${at}.tooltip.title`, s.tooltip.title); check(`${at}.tooltip.body`, s.tooltip.body); }
    if (s.type === "chat") {
      check(`${at}.persona.name`, s.persona.name);
      check(`${at}.persona.role`, s.persona.role);
      s.messages.forEach((m, j) => check(`${at}.messages.${j}`, m.text));
      s.choices.forEach((c, j) => check(`${at}.choices.${j}`, c.label));
    }
    if (s.type === "workflow") {
      check(`${at}.title`, s.title);
      s.nodes.forEach((n, j) => { check(`${at}.nodes.${j}.label`, n.label); check(`${at}.nodes.${j}.detail`, n.detail); });
    }
    if (s.type === "compare") { check(`${at}.caption`, s.caption); check(`${at}.beforeLabel`, s.beforeLabel); check(`${at}.afterLabel`, s.afterLabel); }
  });
  return out;
}

export type { Rect };

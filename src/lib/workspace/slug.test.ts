import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, isReservedSlug, isValidSlug, slugCandidates, slugify } from "./slug";

const take = (gen: Generator<string>, n: number) => Array.from({ length: n }, () => gen.next().value as string);

describe("slugify", () => {
  it.each([
    ["Acme Agency", "acme-agency"],
    ["  Acme   &   Co.  ", "acme-co"],
    ["Café Münster", "cafe-munster"],
    ["Ünïcödé", "unicode"],
    ["--Already--Hyphenated--", "already-hyphenated"],
    ["UPPER_snake_Case", "upper-snake-case"],
    ["a/b\\c?d=e", "a-b-c-d-e"],
  ])("%j -> %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("folds fullwidth and compatibility look-alikes onto ASCII", () => {
    expect(slugify("ａｄｍｉｎ")).toBe("admin");
    expect(slugify("ＡＰＩ")).toBe("api");
    expect(slugify("ｗｗｗ")).toBe("www");
    expect(slugify("①②③ Studio")).toBe("123-studio");
    expect(slugify("ﬁnance")).toBe("finance");
  });

  it("drops characters with no ASCII mapping instead of transliterating them", () => {
    // Cyrillic а (U+0430) and е (U+0435), Greek ο (U+03BF): visually identical to Latin.
    expect(slugify("аdmin")).toBe("dmin");
    expect(slugify("аpi")).toBe("pi");
    expect(slugify("suppоrt")).toBe("supp-rt");
    expect(slugify("арр")).toBe("");
  });

  it("neutralises zero-width and bidi control characters", () => {
    expect(slugify("ad​min")).toBe("ad-min");
    expect(slugify("‮admin‬")).toBe("admin");
  });

  it("never exceeds the length budget and never ends with a hyphen", () => {
    const slug = slugify(`${"word ".repeat(40)}`);
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("slugCandidates", () => {
  it("starts with the plain slug", () => {
    expect(take(slugCandidates("Acme Agency"), 1)).toEqual(["acme-agency"]);
  });

  it("then yields suffixed variants for collisions", () => {
    let n = 0;
    const gen = slugCandidates("Acme", () => `x${n++}`);
    expect(take(gen, 3)).toEqual(["acme", "acme-x0", "acme-x1"]);
  });

  it.each(RESERVED_SLUGS)("never hands out the reserved word %j", (word) => {
    const [first] = take(slugCandidates(word), 1);
    expect(isReservedSlug(first)).toBe(false);
    expect(isValidSlug(first)).toBe(true);
  });

  it.each(["ａｄｍｉｎ", "ＡＰＩ", "WWW", "Admin", "  support  ", "Billing!"])(
    "does not let the look-alike or decorated name %j claim a reserved slug",
    (name) => {
      for (const slug of take(slugCandidates(name), 5)) expect(isValidSlug(slug)).toBe(true);
    },
  );

  it("always yields database-valid slugs, whatever the input", () => {
    const hostile = [
      "", " ", "a", "ab", "💥💥💥", "日本語の会社", "مرحبا", "'; drop table workspaces; --",
      "<script>alert(1)</script>", "../../etc/passwd", "a".repeat(500), "-", "---", "0", "\u0000\u0001",
      "Ａ", "ｉ", "xn--80ak6aa92e", "con", "localhost",
    ];
    for (const name of hostile) {
      for (const slug of take(slugCandidates(name), 4)) {
        expect(isValidSlug(slug), `input ${JSON.stringify(name)} produced ${JSON.stringify(slug)}`).toBe(true);
        expect(slug.length).toBeLessThanOrEqual(63);
      }
    }
  });

  it("falls back to a neutral name when nothing usable remains", () => {
    expect(take(slugCandidates("💥💥💥"), 1)).toEqual(["workspace"]);
  });
});

describe("reserved list", () => {
  it("matches public.is_reserved_slug() in the database migration", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261004000001_identity.sql"), "utf8");
    const body = /select slug = any \(array\[([\s\S]*?)\]\)/.exec(sql)?.[1] ?? "";
    const fromSql = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(fromSql.length).toBeGreaterThan(10);
    expect([...RESERVED_SLUGS].sort()).toEqual(fromSql);
  });

  it("covers every word the build plan names", () => {
    for (const word of ["www", "app", "api", "admin", "i", "mail", "support", "billing", "status", "docs"]) {
      expect(isReservedSlug(word)).toBe(true);
    }
  });
});

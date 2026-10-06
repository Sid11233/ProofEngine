import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 11 audit L1: CLAUDE.md allows the service role only in files that start with `import "server-only"`.
// Any file that imports the admin client or the validated server env must say so itself, so moving it into
// client code fails the build at once instead of relying on the helper it imports.

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".integration.test.ts") ? [path] : [];
  });
}

const SENSITIVE = /from "@\/lib\/supabase\/admin"|from "@\/lib\/security\/env\.server"|from "@\/lib\/limits\.server"/;

describe("server-only imports", () => {
  const files = sourceFiles("src").map((f) => [f, readFileSync(f, "utf8")] as const);

  it("every file that imports the service role client or the server env imports server-only", () => {
    const missing = files.filter(([f, text]) => SENSITIVE.test(text) && !/import "server-only";/.test(text) && !f.endsWith("env.server.ts") && !f.endsWith("limits.server.ts")).map(([f]) => f);
    expect(missing, `add import "server-only" to: ${missing.join(", ")}`).toEqual([]);
  });

  it("no client component imports them at all", () => {
    const offenders = files.filter(([, text]) => /^"use client";/m.test(text) && SENSITIVE.test(text)).map(([f]) => f);
    expect(offenders).toEqual([]);
  });
});

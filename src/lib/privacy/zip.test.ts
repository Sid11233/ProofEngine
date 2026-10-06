import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readZip } from "@/test/zip-reader";
import { createZip } from "./zip";

describe("createZip", () => {
  const entries = [
    { name: "a.json", data: Buffer.from(JSON.stringify({ hello: "world", n: [1, 2, 3] })) },
    { name: "folder/b.txt", data: Buffer.from("x".repeat(100_000)) },
    { name: "empty.txt", data: Buffer.alloc(0) },
    { name: "unicode.json", data: Buffer.from(JSON.stringify({ text: "café ☕ 日本語" })) },
  ];

  it("round-trips every entry through an independent reader (sizes and CRCs verified)", () => {
    const zip = createZip(entries);
    const out = readZip(zip);
    expect(Object.keys(out)).toEqual(entries.map((e) => e.name));
    for (const e of entries) expect(out[e.name].equals(Buffer.from(e.data))).toBe(true);
    expect(zip.length).toBeLessThan(5000);
  });

  it("is accepted by the system unzip tool when one is installed", () => {
    if (spawnSync("unzip", ["-v"]).error) return;
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    try {
      writeFileSync(join(dir, "t.zip"), createZip(entries));
      expect(execFileSync("unzip", ["-t", join(dir, "t.zip")]).toString()).toContain("No errors detected");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses entry names that could escape a folder", () => {
    for (const name of ["../evil.txt", "/abs.txt", "a/../b.txt", "spa ce.txt", "x".repeat(300), "é.txt", ""]) {
      expect(() => createZip([{ name, data: Buffer.from("x") }]), name).toThrow();
    }
  });
});

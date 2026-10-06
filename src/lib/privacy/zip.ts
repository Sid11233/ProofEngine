import { crc32, deflateRawSync } from "node:zlib";

// A small ZIP writer (deflate, no zip64, no encryption) so the data export needs no dependency. Entry names
// are plain ASCII paths; the archive is built in memory and capped by the caller.

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  date?: Date;
}

const MAX_ENTRY = 0xffffffff;

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(d.getUTCFullYear(), 1980);
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

export function createZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (!/^[A-Za-z0-9._\-/]{1,200}$/.test(entry.name) || entry.name.includes("..") || entry.name.startsWith("/")) throw new Error("Unsafe zip entry name");
    const data = Buffer.from(entry.data);
    const compressed = deflateRawSync(data, { level: 6 });
    if (data.length > MAX_ENTRY || compressed.length > MAX_ENTRY || offset > MAX_ENTRY) throw new Error("Archive too large");
    const name = Buffer.from(entry.name, "ascii");
    const { time, date } = dosDateTime(entry.date ?? new Date());
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names flag
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, compressed);

    const entryCentral = Buffer.alloc(46);
    entryCentral.writeUInt32LE(0x02014b50, 0);
    entryCentral.writeUInt16LE(20, 4);
    entryCentral.writeUInt16LE(20, 6);
    entryCentral.writeUInt16LE(0x0800, 8);
    entryCentral.writeUInt16LE(8, 10);
    entryCentral.writeUInt16LE(time, 12);
    entryCentral.writeUInt16LE(date, 14);
    entryCentral.writeUInt32LE(crc, 16);
    entryCentral.writeUInt32LE(compressed.length, 20);
    entryCentral.writeUInt32LE(data.length, 24);
    entryCentral.writeUInt16LE(name.length, 28);
    entryCentral.writeUInt32LE(offset, 42);
    central.push(entryCentral, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

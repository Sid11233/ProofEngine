import { createHash, randomBytes } from "node:crypto";

// Rough de-duplication without remembering anyone. The "same visitor today" key is a hash of the request's
// network address and browser string mixed with a random salt that exists only in this process's memory
// and is replaced every UTC day. Nothing derived from it is ever written to the database, and after a
// restart or at midnight every key is gone, so it cannot be used to follow a person across days.

export interface Deduper {
  /** True the first time this visitor does this event on this page today; false for repeats. */
  firstTime(parts: { ip: string; userAgent: string; page: string; type: string }): boolean;
}

export function createDeduper({ now = () => Date.now(), maxEntries = 100_000 }: { now?: () => number; maxEntries?: number } = {}): Deduper {
  let day = Math.floor(now() / 86_400_000);
  let salt = randomBytes(32);
  let seen = new Set<string>();

  return {
    firstTime({ ip, userAgent, page, type }) {
      const today = Math.floor(now() / 86_400_000);
      if (today !== day || seen.size >= maxEntries) {
        // New day, or memory is full: forget everything. A few repeats may count twice; that is acceptable.
        day = today;
        salt = randomBytes(32);
        seen = new Set();
      }
      const key = createHash("sha256").update(salt).update("\0").update(ip).update("\0").update(userAgent).update("\0").update(page).update("\0").update(type).digest("hex");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  };
}

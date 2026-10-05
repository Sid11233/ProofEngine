import { describe, expect, it } from "vitest";
import { fillDays } from "./load";
import { nextBestAction, type NextActionFacts } from "./next-action";

const none: NextActionFacts = { requestsSent: 0, requestsStale: 0, readyToGenerate: 0, drafts: 0, awaitingApproval: 0, readyToPublish: 0, published: 0 };

describe("nextBestAction", () => {
  it("starts with the first request", () => {
    expect(nextBestAction(none).id).toBe("first");
  });
  it("reminds about clients who have not responded", () => {
    const a = nextBestAction({ ...none, requestsSent: 5, requestsStale: 3 });
    expect(a.id).toBe("remind");
    expect(a.title).toBe("3 clients have not responded yet");
    expect(nextBestAction({ ...none, requestsSent: 5, requestsStale: 1 }).title).toBe("1 client has not responded yet");
  });
  it("prefers publishing over generating over asking for approval over reminding", () => {
    const busy = { ...none, requestsSent: 9, requestsStale: 2, readyToGenerate: 1, drafts: 1, readyToPublish: 1, awaitingApproval: 1 };
    expect(nextBestAction(busy).id).toBe("publish");
    expect(nextBestAction({ ...busy, readyToPublish: 0 }).id).toBe("generate");
    expect(nextBestAction({ ...busy, readyToPublish: 0, readyToGenerate: 0 }).id).toBe("approval");
    expect(nextBestAction({ ...busy, readyToPublish: 0, readyToGenerate: 0, drafts: 0 }).id).toBe("remind");
    expect(nextBestAction({ ...none, requestsSent: 2, awaitingApproval: 2 }).id).toBe("wait");
  });
  it("always points somewhere inside the app", () => {
    for (const f of [none, { ...none, requestsSent: 1 }, { ...none, requestsSent: 1, published: 2 }, { ...none, drafts: 1 }]) expect(nextBestAction(f).href.startsWith("/app/")).toBe(true);
  });
});

describe("fillDays", () => {
  it("returns 30 consecutive UTC days oldest first, with zeros for quiet days", () => {
    const now = Date.parse("2026-10-30T12:00:00Z");
    const days = fillDays([{ day: "2026-10-30", events: 4 }, { day: "2026-10-01", events: 2 }, { day: "2026-10-01", events: 1 }, { day: "2026-08-01", events: 99 }], now);
    expect(days).toHaveLength(30);
    expect(days[0]).toEqual({ day: "2026-10-01", n: 3 });
    expect(days[29]).toEqual({ day: "2026-10-30", n: 4 });
    expect(days.reduce((n, d) => n + d.n, 0)).toBe(7);
  });
});

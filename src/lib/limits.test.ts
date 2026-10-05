import { describe, expect, it } from "vitest";
import { aiMessageLimitFor, resolveLimits } from "./limits";

describe("resolveLimits", () => {
  it("has sensible defaults", () => {
    expect(resolveLimits({})).toEqual({
      aiMessagesPerMonth: { free: 100, pro: 3000, team: 20000 },
      aiDailyTokenLimit: 2_000_000,
      interviewStartsPerIpHour: 5,
    });
  });

  it("is overridable by environment variables, as strings or numbers", () => {
    const limits = resolveLimits({ AI_MESSAGES_FREE: "10", AI_MESSAGES_PRO: 99, AI_DAILY_TOKEN_LIMIT: "500", INTERVIEW_STARTS_PER_IP_HOUR: "2" });
    expect(limits.aiMessagesPerMonth.free).toBe(10);
    expect(limits.aiMessagesPerMonth.pro).toBe(99);
    expect(limits.aiDailyTokenLimit).toBe(500);
    expect(limits.interviewStartsPerIpHour).toBe(2);
  });

  it("ignores junk and keeps the default; never allows a zero daily or per-IP limit", () => {
    expect(resolveLimits({ AI_MESSAGES_FREE: "lots", AI_MESSAGES_PRO: "-5" }).aiMessagesPerMonth).toMatchObject({ free: 100, pro: 3000 });
    expect(resolveLimits({ AI_DAILY_TOKEN_LIMIT: "0", INTERVIEW_STARTS_PER_IP_HOUR: "0" })).toMatchObject({ aiDailyTokenLimit: 1, interviewStartsPerIpHour: 1 });
  });
});

describe("aiMessageLimitFor", () => {
  it("maps plans, treating anything unknown as free", () => {
    const limits = resolveLimits({});
    expect(aiMessageLimitFor("pro", limits)).toBe(3000);
    expect(aiMessageLimitFor("team", limits)).toBe(20000);
    expect(aiMessageLimitFor("free", limits)).toBe(100);
    expect(aiMessageLimitFor("enterprise?", limits)).toBe(100);
  });
});

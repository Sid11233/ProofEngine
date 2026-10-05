// Every abuse and spend limit in one place, each overridable by an env var (see
// docs/limits.md). The functions take an env object so they can be tested.

export interface Limits {
  /** AI messages a workspace may use per calendar month, by plan. */
  aiMessagesPerMonth: { free: number; pro: number; team: number };
  /** Total AI tokens per UTC day across the whole platform before interviews pause. */
  aiDailyTokenLimit: number;
  /** Interviews one IP address may start per hour. */
  interviewStartsPerIpHour: number;
}

type EnvLike = Partial<Record<string, string | number | undefined>>;

const num = (value: string | number | undefined, fallback: number) => {
  const parsed = typeof value === "number" ? value : value ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
};

export function resolveLimits(env: EnvLike): Limits {
  return {
    aiMessagesPerMonth: {
      free: num(env.AI_MESSAGES_FREE, 100),
      pro: num(env.AI_MESSAGES_PRO, 3000),
      team: num(env.AI_MESSAGES_TEAM, 20000),
    },
    aiDailyTokenLimit: Math.max(1, num(env.AI_DAILY_TOKEN_LIMIT, 2_000_000)),
    interviewStartsPerIpHour: Math.max(1, num(env.INTERVIEW_STARTS_PER_IP_HOUR, 5)),
  };
}

export function aiMessageLimitFor(plan: string, limits: Limits): number {
  if (plan === "pro") return limits.aiMessagesPerMonth.pro;
  if (plan === "team") return limits.aiMessagesPerMonth.team;
  return limits.aiMessagesPerMonth.free;
}

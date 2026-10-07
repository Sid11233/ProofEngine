export type PillTone = "green" | "amber" | "blue" | "grey" | "red" | "orange";

const TONES: Record<PillTone, { pill: string; dot: string }> = {
  green: { pill: "bg-[#ecfdf3] text-[#166534]", dot: "bg-[#16a34a]" },
  amber: { pill: "bg-[#fff7e0] text-[#8a5a00]", dot: "bg-[#d99a00]" },
  blue: { pill: "bg-[#eff6ff] text-[#1e40af]", dot: "bg-[#3b82f6]" },
  grey: { pill: "bg-[#f5f5f4] text-[#57534e]", dot: "bg-[#a8a29e]" },
  red: { pill: "bg-[#fef2f2] text-[#991b1b]", dot: "bg-[#dc2626]" },
  orange: { pill: "bg-tint text-[#b43a0c]", dot: "bg-signal" },
};

/** Which colour each status gets, in one place. Unknown statuses are grey. */
export const STATUS_TONE: Record<string, PillTone> = {
  sent: "amber", started: "blue", completed: "green", expired: "grey", revoked: "grey",
  draft: "grey", awaiting_client_approval: "amber", approved: "blue", published: "green", unpublished: "grey",
  new: "orange", contacted: "blue", won: "green", dismissed: "grey",
};

export const STATUS_LABEL: Record<string, string> = {
  sent: "Sent", started: "Started", completed: "Completed", expired: "Expired", revoked: "Revoked",
  draft: "Draft", awaiting_client_approval: "Awaiting client", approved: "Approved", published: "Published", unpublished: "Unpublished",
  new: "New", contacted: "Contacted", won: "Won", dismissed: "Dismissed",
};

/** A status with a coloured dot. The label is always text, so colour is never the only signal. */
export function StatusPill({ status, label, tone }: { status?: string; label?: string; tone?: PillTone }) {
  const chosen = tone ?? STATUS_TONE[status ?? ""] ?? "grey";
  const look = TONES[chosen];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${look.pill}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${look.dot}`} />
      {label ?? STATUS_LABEL[status ?? ""] ?? status}
    </span>
  );
}

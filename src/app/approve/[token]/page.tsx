import { redirect } from "next/navigation";
import { z } from "zod";

// Older emails linked here. Approval and signature are one step now, at /sign/<token>; the same link works.
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function ApproveRedirect({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(z.string().regex(/^[A-Za-z0-9_-]{43}$/).safeParse(token).success ? `/sign/${token}` : "/");
}

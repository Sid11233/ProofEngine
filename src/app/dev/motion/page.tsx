import "server-only";
import { cookies } from "next/headers";
import { MotionLab } from "@/components/motion/motion-lab";
import { pageTitle } from "@/lib/brand";
import { MOTION_REGISTRY } from "@/lib/motion/registry";
import { MOTION_COOKIE, parsePreference } from "@/lib/motion/preference";
import { requirePlatformAdmin } from "@/lib/takedown/admin";

export const metadata = { title: pageTitle("Motion lab"), robots: { index: false, follow: false } };

// A developer page: every registered animation with a live demo and the reduced-motion switch. Open in
// development; in production only platform operators (PLATFORM_ADMIN_EMAILS) can see it.
export default async function MotionLabPage() {
  if (process.env.NODE_ENV === "production") await requirePlatformAdmin();
  const preference = parsePreference((await cookies()).get(MOTION_COOKIE)?.value);
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">Motion lab</h1>
      <p className="text-neutral-600">Registered animations from <code>src/lib/motion/registry.ts</code>. Flip the setting to check every reduced-motion fallback.</p>
      <MotionLab entries={MOTION_REGISTRY} initialPreference={preference} />
    </main>
  );
}

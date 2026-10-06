import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { MotionPreferenceControl } from "@/components/motion/motion-preference-control";

export const metadata = { title: pageTitle("Motion") };

export default async function MotionSettingsPage() {
  await requireUser();
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Motion</h1>
        <p className="mt-1 text-neutral-600">Choose how much the app moves. This is saved in this browser and overrides your device setting.</p>
      </div>
      <MotionPreferenceControl />
    </div>
  );
}

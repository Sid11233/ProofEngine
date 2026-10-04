"use client";

export function LinkOnce({ link }: { link: string }) {
  return (
    <div className="space-y-1 text-sm">
      <p className="font-medium">Interview link (shown once)</p>
      <input
        readOnly
        value={link}
        aria-label="Interview link"
        onFocus={(event) => event.currentTarget.select()}
        className="block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 font-mono text-sm dark:border-neutral-700"
      />
      <p className="text-neutral-600 dark:text-neutral-400">
        We only store a fingerprint of this link, so it cannot be shown again. Use &ldquo;New link&rdquo; if you lose it.
      </p>
    </div>
  );
}

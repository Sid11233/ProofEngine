export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <p className="text-center text-lg font-semibold tracking-tight">Proof Engine</p>
        <div className="space-y-5 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">{children}</div>
      </div>
    </main>
  );
}

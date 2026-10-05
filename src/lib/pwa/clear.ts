// Browser-side cleanup for sign out: drop every cache this app made and stop push on this device.
// Safe to call anywhere (no-ops where the APIs do not exist) and it never throws.

export async function clearPwaState(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration("/app/");
      registration?.active?.postMessage({ type: "clear-caches" });
      const subscription = await registration?.pushManager?.getSubscription();
      await subscription?.unsubscribe();
      // Remove the worker itself so requests still in flight cannot refill a cache after we clear it.
      // The signed-in layout registers it again at the next sign in.
      await registration?.unregister();
    }
    if ("caches" in window) {
      const drop = async () => Promise.all((await caches.keys()).filter((k) => k.startsWith("pe-")).map((k) => caches.delete(k)));
      await drop();
      // A request that was already in flight may finish just after: sweep once more.
      await new Promise((resolve) => setTimeout(resolve, 150));
      await drop();
    }
  } catch {
    /* nothing useful to do: the worker only ever stored public static files */
  }
}

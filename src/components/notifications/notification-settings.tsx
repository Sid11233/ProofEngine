"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import type { NotificationActionResult } from "@/app/app/settings/notifications/actions";
import { urlBase64ToUint8Array } from "@/lib/pwa/vapid";

interface Props {
  vapidKey: string | null;
  initial: { clientCompleted: boolean; approvalReceived: boolean; referralReceived: boolean };
  actions: {
    savePreferences: (input: unknown) => Promise<NotificationActionResult>;
    saveSubscription: (input: unknown) => Promise<NotificationActionResult>;
    removeSubscription: (input: unknown) => Promise<NotificationActionResult>;
  };
}

const EVENTS = [
  { key: "clientCompleted", label: "A client finished their interview" },
  { key: "approvalReceived", label: "A client approved a case study" },
  { key: "referralReceived", label: "A client suggested someone" },
] as const;

const noopSubscribe = () => () => undefined;
const button = "inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-5 font-medium disabled:opacity-50 dark:border-neutral-700";

export function NotificationSettings({ vapidKey, initial, actions }: Props) {
  const [prefs, setPrefs] = useState(initial);
  const [message, setMessage] = useState<string>();
  // Browser capabilities: unknown (null) on the server and until the page is in the browser.
  const supported = useSyncExternalStore(noopSubscribe, () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window, () => null);
  const [asked, setAsked] = useState<NotificationPermission | null>(null);
  const permission: NotificationPermission = asked ?? (supported ? Notification.permission : "default");
  const [deviceOn, setDeviceOn] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.getRegistration("/app/").then((r) => r?.pushManager.getSubscription()).then((s) => setDeviceOn(Boolean(s)), () => undefined);
  }, [supported]);

  function togglePref(key: (typeof EVENTS)[number]["key"], value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setMessage(undefined);
    start(async () => {
      const result = await actions.savePreferences(next);
      if (!result.ok) {
        setPrefs(prefs);
        setMessage(result.message ?? "We could not save that.");
      }
    });
  }

  // Permission is only ever requested here, from a click.
  function enable() {
    setMessage(undefined);
    start(async () => {
      try {
        const answer = await Notification.requestPermission();
        setAsked(answer);
        if (answer !== "granted" || !vapidKey) return setMessage(answer === "denied" ? "Notifications are blocked for this site in your browser settings." : "Notifications were not turned on.");
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
        const json = subscription.toJSON();
        const result = await actions.saveSubscription({ endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth });
        if (!result.ok) {
          await subscription.unsubscribe();
          return setMessage(result.message ?? "We could not turn notifications on.");
        }
        setDeviceOn(true);
        setMessage("Notifications are on for this device.");
      } catch {
        setMessage("This browser could not turn notifications on.");
      }
    });
  }

  function disable() {
    setMessage(undefined);
    start(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration("/app/");
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await actions.removeSubscription({ endpoint: subscription.endpoint });
          await subscription.unsubscribe();
        }
        setDeviceOn(false);
        setMessage("Notifications are off for this device.");
      } catch {
        setMessage("We could not turn notifications off. Try again.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="events-heading" className="space-y-3">
        <h2 id="events-heading" className="text-lg font-semibold">Tell me when</h2>
        {EVENTS.map((e) => (
          <label key={e.key} className="flex min-h-11 items-center gap-3">
            <input type="checkbox" className="size-5" checked={prefs[e.key]} disabled={pending} onChange={(ev) => togglePref(e.key, ev.target.checked)} />
            <span>{e.label}</span>
          </label>
        ))}
      </section>

      <section aria-labelledby="device-heading" className="space-y-2">
        <h2 id="device-heading" className="text-lg font-semibold">This device</h2>
        {supported === false ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">This browser does not support notifications. On iPhone and iPad, add the app to your home screen first, then come back here.</p>
        ) : !vapidKey ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Notifications are not set up on this server yet.</p>
        ) : deviceOn ? (
          <button type="button" className={button} disabled={pending} onClick={disable}>Turn off on this device</button>
        ) : permission === "denied" ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Notifications are blocked for this site. Allow them in your browser&rsquo;s site settings, then reload this page.</p>
        ) : (
          <button type="button" className={button} disabled={pending || supported === null} onClick={enable}>Turn on for this device</button>
        )}
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Messages are short and generic, for example &ldquo;A client finished their interview&rdquo;. They never include names or answers, and opening one still requires you to be signed in.</p>
      </section>

      <div role="status" aria-live="polite">{message ? <p className="text-sm">{message}</p> : null}</div>
    </div>
  );
}

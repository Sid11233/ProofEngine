/* Service worker for the signed-in app (scope /app/). It caches static build assets and nothing else.
 *
 * Never cached, by construction (these requests are not handled here at all, so the browser goes to the
 * network): navigations, /api, /i interview pages, /preview, /approve, /unsubscribe, public pages,
 * anything with an Authorization header, partial (Range) requests, non-GET requests, and any response
 * that is not a plain successful same-origin one. Pages are never stored, so no transcript, case study or
 * account data ever lands in a cache.
 *
 * Offline: a failed navigation shows the static branded offline page.
 */
"use strict";

const VERSION = "v1";
const PREFIX = "pe-";
const CACHE = `${PREFIX}static-${VERSION}`;
const PRECACHE = ["/offline.html", "/offline.css", "/icons/icon-192.png"];
const STATIC_PATHS = [/^\/_next\/static\//, /^\/icons\//, /^\/offline\.(html|css)$/];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Delete every older cache of ours (a new VERSION is a new name).
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Set when sign out asks for everything to be dropped: requests still in flight must not refill a cache.
let cleared = false;

const isStatic = (url) => url.origin === self.location.origin && STATIC_PATHS.some((re) => re.test(url.pathname));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("authorization") || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Network only. If it fails, show the offline page. The page itself is never stored.
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html").then((r) => r || Response.error())));
    return;
  }
  if (!isStatic(url)) return;

  event.respondWith(
    caches.match(request, { cacheName: CACHE }).then(async (hit) => {
      if (hit) return hit;
      const response = await fetch(request);
      // Only plain, successful, same-origin, cookie-free responses are stored, and never after a clear.
      if (!cleared && response.ok && response.type === "basic" && !response.headers.has("set-cookie")) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => (cleared ? undefined : cache.put(request, copy))));
      }
      return response;
    }),
  );
});

// Sign out (or anything else) can ask for everything of ours to be dropped.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "clear-caches") {
    cleared = true;
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX)).map((k) => caches.delete(k)))));
  }
});

/* Web push (Phase 9.3): payloads are generic and never carry client details. Only a short title, a short
 * body and an in-app path are used; anything else in the payload is ignored. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title.length <= 80 ? data.title : "Notification";
  const body = typeof data.body === "string" && data.body.length <= 160 ? data.body : "";
  const path = typeof data.url === "string" && /^\/app\/[A-Za-z0-9/_-]{0,100}$/.test(data.url) ? data.url : "/app/dashboard";
  event.waitUntil(self.registration.showNotification(title, { body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { path }, tag: "pe-" + path }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data && typeof event.notification.data.path === "string" ? event.notification.data.path : "/app/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          w.navigate(path);
          return w.focus();
        }
      }
      return self.clients.openWindow(path);
    }),
  );
});

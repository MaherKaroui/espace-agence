// IZISuivis — Service Worker Web Push
// Tickle-only push (no payload) + rich fallback with body when server sends JSON.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try { payload = event.data.json(); } catch { payload = { titre: event.data.text() }; }
  }
  const title = payload.titre || "IZISuivis";
  const body = payload.message || "Nouvelle notification";
  const url = payload.url || "/";

  event.waitUntil(
    (async () => {
      // If a client window is focused, skip OS notification — the in-app bell handles it.
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const hasFocused = clientsList.some((c) => c.focused);
      if (hasFocused) return;

      await self.registration.showNotification(title, {
        body,
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        tag: payload.tag || "izisuivis",
        renotify: true,
        data: { url },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clientsList) {
        if ("focus" in c) { await c.focus(); if (c.navigate) await c.navigate(url); return; }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});

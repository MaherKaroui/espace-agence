// IZISuivis — Service Worker Web Push réel
// Ancien chemin conservé pour les navigateurs déjà abonnés sur /sw.js.
// Important : afficher aussi lorsque l'application est ouverte, sinon le test admin semble ne rien recevoir.

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
  const title = payload.titre || payload.title || "IZISuivis";
  const body = payload.message || payload.body || "Nouvelle notification";
  const url = payload.link || payload.url || "/notifications";
  const tag = payload.tag || payload.id || "izisuivis-notification";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag,
      renotify: true,
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notifications";
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

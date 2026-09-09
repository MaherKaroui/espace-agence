// IZISuivis — Service Worker Web Push réel
// Reçoit les notifications Web Push même lorsque l'application n'est pas ouverte.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { titre: event.data.text() };
    }
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
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/notifications";
  // URL absolue : client.navigate() et openWindow() refusent les chemins relatifs sur iOS/Android.
  const target = new URL(raw, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const sameOrigin = clientsList.filter((c) => {
        try { return new URL(c.url).origin === self.location.origin; } catch { return false; }
      });

      // 1) Un onglet/app déjà ouvert : on le focus puis on navigue vers la cible exacte.
      for (const client of sameOrigin) {
        try {
          if ("focus" in client) await client.focus();
          // Navigation interne au routeur si l'app écoute, sinon navigation dure.
          client.postMessage({ type: "notification-click", url: target });
          if ("navigate" in client && client.url !== target) {
            try { await client.navigate(target); } catch { /* iOS peut refuser : le postMessage prend le relais */ }
          }
          return;
        } catch { /* on tente le client suivant */ }
      }

      // 2) Aucune fenêtre ouverte : on en ouvre une directement sur la cible.
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })(),
  );
});

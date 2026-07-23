// Notifications navigateur (Web Notifications API).
// Volontairement sans Service Worker / VAPID pour rester compatible
// avec la préview Lovable et éviter la config PWA. Fonctionne quand
// au moins un onglet IZISuivis est ouvert.

const STORAGE_KEY = "izisuivis.webpush.enabled";
const SEEN_KEY = "izisuivis.webpush.seen"; // évite les doublons cross-tab

export function isBrowserNotifSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getBrowserNotifPermission(): NotificationPermission | "unsupported" {
  if (!isBrowserNotifSupported()) return "unsupported";
  return Notification.permission;
}

export function isBrowserNotifEnabled(): boolean {
  if (!isBrowserNotifSupported()) return false;
  if (Notification.permission !== "granted") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setBrowserNotifEnabled(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
}

export async function requestBrowserNotifPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isBrowserNotifSupported()) return "unsupported";
  if (Notification.permission === "granted") {
    setBrowserNotifEnabled(true);
    return "granted";
  }
  if (Notification.permission === "denied") return "denied";
  const res = await Notification.requestPermission();
  if (res === "granted") setBrowserNotifEnabled(true);
  return res;
}

function markSeen(id: string): boolean {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const set = new Set<string>(raw ? JSON.parse(raw) : []);
    if (set.has(id)) return false;
    set.add(id);
    // conserver au plus 200 IDs
    const arr = Array.from(set).slice(-200);
    localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
    return true;
  } catch {
    return true;
  }
}

export function showBrowserNotif(opts: {
  id: string;
  title: string;
  body?: string | null;
  link?: string | null;
  tag?: string;
}) {
  if (!isBrowserNotifEnabled()) return;
  if (!markSeen(opts.id)) return;
  try {
    const n = new Notification(opts.title, {
      body: opts.body ?? undefined,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: opts.tag ?? opts.id,
      silent: false,
    });
    n.onclick = () => {
      try {
        window.focus();
        if (opts.link) window.location.assign(opts.link);
      } catch {
        // ignore
      }
      n.close();
    };
  } catch {
    // Certains navigateurs (iOS Safari sans PWA installée) refusent silencieusement.
  }
}

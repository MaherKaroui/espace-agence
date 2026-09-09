import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

/**
 * Ouvre directement l'élément concerné quand l'utilisateur touche une notification.
 * Le service worker envoie { type: "notification-click", url } à la fenêtre ouverte ;
 * on navigue alors côté routeur, sans rechargement (utile sur iOS où
 * client.navigate() est parfois refusé).
 */
export function NotificationClickBridge() {
  const router = useRouter();

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== "notification-click" || typeof data.url !== "string") return;
      try {
        const target = new URL(data.url, window.location.origin);
        if (target.origin !== window.location.origin) return;
        const path = target.pathname + target.search + target.hash;
        if (path === window.location.pathname + window.location.search + window.location.hash) return;
        router.history.push(path);
      } catch {
        /* lien illisible : on ignore */
      }
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);

  return null;
}

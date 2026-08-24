import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getVapidPublicKey,
  getPushSubscriptionStatus,
  savePushSubscription,
  deletePushSubscription,
} from "@/lib/push.functions";
import { setBrowserNotifEnabled } from "@/lib/web-push";
import { toast } from "sonner";

/**
 * UNIQUE implémentation de l'abonnement Web Push de l'application.
 * Tout composant proposant l'activation (WebPushToggle, cloche, bannière)
 * DOIT passer par ce hook — aucune logique dupliquée ailleurs.
 */

const SERVICE_WORKER_URL = "/service-worker.js";

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufToB64Url(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const arr = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type PushPlatform = {
  isSafari: boolean;
  isIOS: boolean;
  isMacSafari: boolean;
  isStandalone: boolean;
};

export function detectPushPlatform(): PushPlatform {
  if (typeof navigator === "undefined") {
    return { isSafari: false, isIOS: false, isMacSafari: false, isStandalone: false };
  }
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR/.test(ua);
  const isMacSafari = isSafari && !isIOS && /Macintosh/.test(ua);
  const isStandalone =
    (typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches) ||
    (navigator as any).standalone === true;
  return { isSafari, isIOS, isMacSafari, isStandalone };
}

export function useWebPush() {
  const getKey = useServerFn(getVapidPublicKey);
  const getStatus = useServerFn(getPushSubscriptionStatus);
  const saveSub = useServerFn(savePushSubscription);
  const delSub = useServerFn(deletePushSubscription);

  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [platform, setPlatform] = useState<PushPlatform>(() => detectPushPlatform());

  // Préparés EN AMONT pour que subscribe() reste dans le geste utilisateur (Safari).
  const regRef = useRef<ServiceWorkerRegistration | null>(null);
  const keyRef = useRef<string>("");
  const subRef = useRef<PushSubscription | null>(null);

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(ok);
    setPlatform(detectPushPlatform());
    if (!ok) return;
    setPermission(Notification.permission);
    let cancelled = false;
    (async () => {
      try {
        const [reg, keyRes] = await Promise.all([
          navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" }),
          getKey().catch(() => ({ key: "" })),
        ]);
        await reg.update().catch(() => undefined);
        const readyReg = await navigator.serviceWorker.ready;
        if (cancelled) return;
        regRef.current = readyReg;
        keyRef.current = keyRes?.key ?? "";
        setReady(!!keyRef.current);
        const sub = await readyReg.pushManager.getSubscription();
        subRef.current = sub;
        const status = await getStatus({ data: { endpoint: sub?.endpoint ?? null } });
        if (cancelled) return;
        setSubscribed(status.currentDeviceSaved);
        if (!status.currentDeviceSaved) setBrowserNotifEnabled(false);
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getKey, getStatus]);

  const platformHint =
    platform.isIOS && !platform.isStandalone
      ? "iPhone / iPad : ouvrez d'abord IZISuivis depuis l'écran d'accueil (bouton Partager → « Sur l'écran d'accueil »). Les notifications ne sont possibles que depuis l'application installée."
      : platform.isMacSafari && !platform.isStandalone
        ? "Mac avec Safari : ajoutez d'abord IZISuivis au Dock (menu Fichier → « Ajouter au Dock »), puis activez les notifications depuis l'application."
        : null;

  const friendlyError = useCallback(
    (e: any): string => {
      const name = e?.name || "";
      const { isIOS, isMacSafari, isStandalone } = platform;
      if (name === "NotAllowedError" || /not allowed|user gesture|denied/i.test(e?.message ?? "")) {
        if (isIOS && !isStandalone) {
          return "Sur iPhone, ouvrez d'abord IZISuivis depuis l'écran d'accueil : bouton Partager, puis « Sur l'écran d'accueil ». Les notifications ne sont possibles que depuis l'application installée.";
        }
        if (isMacSafari) {
          return "Sur Mac avec Safari, ajoutez d'abord IZISuivis au Dock : menu Fichier, puis « Ajouter au Dock ».";
        }
      }
      return e?.message || "Impossible d'activer les notifications";
    },
    [platform],
  );

  const enable = useCallback(async () => {
    setLoading(true);
    try {
      const readyReg = regRef.current ?? (await navigator.serviceWorker.ready);
      const key = keyRef.current || (await getKey()).key;
      if (!key) {
        toast.error("Clé serveur indisponible");
        return false;
      }
      regRef.current = readyReg;
      keyRef.current = key;
      const appServerKey = urlBase64ToUint8Array(key).buffer as ArrayBuffer;

      // 1) permission -> 2) subscribe IMMÉDIATEMENT (aucun await intermédiaire, Safari)
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        toast.error("Permission refusée");
        return false;
      }

      let sub =
        subRef.current ??
        (await readyReg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey,
        }));

      const saveCurrentSubscription = () =>
        saveSub({
          data: {
            endpoint: sub.endpoint,
            p256dh: bufToB64Url(sub.getKey("p256dh")),
            auth: bufToB64Url(sub.getKey("auth")),
            user_agent: navigator.userAgent,
          },
        });

      try {
        await saveCurrentSubscription();
      } catch (saveErr: any) {
        const msg = String(saveErr?.message ?? "");
        const isKeyConflict = /applicationServerKey|vapid|clé|key|conflict|duplicate|already exists/i.test(msg);
        if (!isKeyConflict) throw saveErr;
        await sub.unsubscribe().catch(() => undefined);
        sub = await readyReg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key).buffer as ArrayBuffer,
        });
        await saveCurrentSubscription();
      }
      subRef.current = sub;
      setSubscribed(true);
      setBrowserNotifEnabled(true);
      toast.success("Notifications navigateur activées");
      return true;
    } catch (e: any) {
      console.error(e);
      toast.error(friendlyError(e));
      return false;
    } finally {
      setLoading(false);
    }
  }, [friendlyError, getKey, saveSub]);

  const disable = useCallback(async () => {
    setLoading(true);
    try {
      const reg = regRef.current ?? (await navigator.serviceWorker.getRegistration("/"));
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await delSub({ data: { endpoint: sub.endpoint } }).catch(() => undefined);
        await sub.unsubscribe().catch(() => undefined);
      }
      subRef.current = null;
      setSubscribed(false);
      setBrowserNotifEnabled(false);
      toast.success("Notifications navigateur désactivées");
      return true;
    } catch (e: any) {
      toast.error(e?.message || "Erreur");
      return false;
    } finally {
      setLoading(false);
    }
  }, [delSub]);

  return { supported, permission, subscribed, loading, ready, platform, platformHint, enable, disable };
}

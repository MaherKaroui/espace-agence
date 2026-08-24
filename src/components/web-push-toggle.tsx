import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Bell, BellOff, CheckCircle2, MonitorSmartphone, XCircle } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getVapidPublicKey, getPushSubscriptionStatus, savePushSubscription, deletePushSubscription } from "@/lib/push.functions";
import { toast } from "sonner";

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
  let s = ""; for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function detectPlatform() {
  if (typeof navigator === "undefined") return { isSafari: false, isIOS: false, isMacSafari: false, isStandalone: false };
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR/.test(ua);
  const isMacSafari = isSafari && !isIOS && /Macintosh/.test(ua);
  const isStandalone =
    (typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches) ||
    (navigator as any).standalone === true;
  return { isSafari, isIOS, isMacSafari, isStandalone };
}

export function WebPushToggle() {
  const getKey = useServerFn(getVapidPublicKey);
  const getStatus = useServerFn(getPushSubscriptionStatus);
  const saveSub = useServerFn(savePushSubscription);
  const delSub = useServerFn(deletePushSubscription);

  const [supported, setSupported] = useState<boolean>(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [ready, setReady] = useState<boolean>(false);
  const [platform, setPlatform] = useState(() => detectPlatform());

  // Préparés EN AMONT pour que subscribe() reste dans le geste utilisateur (Safari).
  const regRef = useRef<ServiceWorkerRegistration | null>(null);
  const keyRef = useRef<string>("");
  const subRef = useRef<PushSubscription | null>(null);

  const stateLabel = !supported
    ? "Non configuré"
    : permission === "denied"
      ? "Refusé"
      : subscribed && permission === "granted"
        ? "Activé"
        : "Non configuré";

  const stateClass = stateLabel === "Activé"
    ? "border-success/30 bg-success/10 text-success"
    : stateLabel === "Refusé"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : "border-border bg-muted text-muted-foreground";

  useEffect(() => {
    const ok = typeof window !== "undefined"
      && "serviceWorker" in navigator
      && "PushManager" in window
      && "Notification" in window;
    setSupported(ok);
    setPlatform(detectPlatform());
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
        if (!cancelled) setSubscribed(status.currentDeviceSaved);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [getStatus, getKey]);

  const friendlyError = (e: any): string => {
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
  };

  const enable = async () => {
    setLoading(true);
    try {
      const readyReg = regRef.current ?? (await navigator.serviceWorker.ready);
      const key = keyRef.current || (await getKey()).key;
      if (!key) { toast.error("Clé serveur indisponible"); return; }
      regRef.current = readyReg;
      keyRef.current = key;
      const appServerKey = urlBase64ToUint8Array(key).buffer as ArrayBuffer;

      // 1) permission -> 2) subscribe IMMÉDIATEMENT (aucun await intermédiaire)
      const perm = await Notification.requestPermission();
      // Test SYNCHRONE uniquement : ne casse pas la chaîne d'activation utilisateur (Safari).
      setPermission(perm);
      if (perm !== "granted") { toast.error("Permission refusée"); return; }

      let sub = subRef.current ?? await readyReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      });

      const saveCurrentSubscription = () => saveSub({
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
        // Repli UNIQUEMENT en cas de conflit de clé serveur (abonnement obsolète).
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
      toast.success("Notifications navigateur activées");
    } catch (e: any) {
      console.error(e);
      toast.error(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    setLoading(true);
    try {
      const reg = regRef.current ?? await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await delSub({ data: { endpoint: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe();
      }
      subRef.current = null;
      setSubscribed(false);
      toast.success("Notifications navigateur désactivées");
    } catch (e: any) {
      toast.error(e?.message || "Erreur");
    } finally {
      setLoading(false);
    }
  };

  if (!supported) {
    return (
      <Card className="p-4 flex items-start gap-3">
        <MonitorSmartphone className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground space-y-1">
          <div className="font-medium text-foreground">Notifications navigateur / PC</div>
          <div>État : <span className="font-medium">Non configuré</span></div>
          <div>Ce navigateur ne prend pas en charge les notifications navigateur. Vous continuez à recevoir les alertes dans la cloche IZISuivis.</div>
        </div>
      </Card>
    );
  }

  const safariHint = platform.isIOS && !platform.isStandalone
    ? "iPhone / iPad : ouvrez d'abord IZISuivis depuis l'écran d'accueil (bouton Partager → « Sur l'écran d'accueil »). Les notifications ne sont possibles que depuis l'application installée."
    : platform.isMacSafari && !platform.isStandalone
      ? "Mac avec Safari : ajoutez d'abord IZISuivis au Dock (menu Fichier → « Ajouter au Dock »), puis activez les notifications depuis l'application."
      : null;

  return (
    <Card className="p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        <MonitorSmartphone className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-medium">Notifications navigateur / PC</div>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${stateClass}`}>
              {stateLabel === "Activé" ? <CheckCircle2 className="h-3 w-3" /> : stateLabel === "Refusé" ? <XCircle className="h-3 w-3" /> : null}
              {stateLabel}
            </span>
          </div>
          <div className="text-sm text-muted-foreground">
            Recevez les alertes IZISuivis même si vous n'êtes pas sur la page. Si le navigateur refuse, la cloche interne reste active.
          </div>
          {safariHint && (
            <div className="text-xs text-muted-foreground mt-1 rounded-md border border-border bg-muted/50 px-2 py-1.5">
              {safariHint}
            </div>
          )}
          {permission === "denied" && (
            <div className="text-xs text-destructive mt-1">
              Les notifications sont bloquées dans les paramètres du navigateur — autorisez-les puis rechargez la page.
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 sm:pt-0.5">
        {subscribed ? (
          <Button variant="outline" onClick={disable} disabled={loading} className="gap-2">
            <BellOff className="h-4 w-4" /> Désactiver
          </Button>
        ) : (
          <Button onClick={enable} disabled={loading || permission === "denied" || !ready} className="gap-2">
            <Bell className="h-4 w-4" /> Activer les notifications navigateur
          </Button>
        )}
      </div>
    </Card>
  );
}

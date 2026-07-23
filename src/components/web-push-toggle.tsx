import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Bell, BellOff, CheckCircle2, MonitorSmartphone, XCircle } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getVapidPublicKey, savePushSubscription, deletePushSubscription } from "@/lib/push.functions";
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

export function WebPushToggle() {
  const getKey = useServerFn(getVapidPublicKey);
  const saveSub = useServerFn(savePushSubscription);
  const delSub = useServerFn(deletePushSubscription);

  const [supported, setSupported] = useState<boolean>(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

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
    if (!ok) return;
    setPermission(Notification.permission);
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration("/")
          ?? await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          setSubscribed(!!sub);
        }
      } catch { /* noop */ }
    })();
  }, []);

  const enable = async () => {
    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") { toast.error("Permission refusée"); return; }

      const { key } = await getKey();
      if (!key) { toast.error("Clé serveur indisponible"); return; }

      const reg = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
      const readyReg = await navigator.serviceWorker.ready;
      await reg.update().catch(() => undefined);

      const existing = await readyReg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe().catch(() => undefined);

      const sub = await readyReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key).buffer as ArrayBuffer,
      });

      const p256dh = bufToB64Url(sub.getKey("p256dh"));
      const authKey = bufToB64Url(sub.getKey("auth"));

      await saveSub({
        data: {
          endpoint: sub.endpoint,
          p256dh,
          auth: authKey,
          user_agent: navigator.userAgent,
        },
      });
      setSubscribed(true);
      toast.success("Notifications navigateur activées");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Impossible d'activer les notifications");
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await delSub({ data: { endpoint: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe();
      }
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
          <Button onClick={enable} disabled={loading || permission === "denied"} className="gap-2">
            <Bell className="h-4 w-4" /> Activer les notifications navigateur
          </Button>
        )}
      </div>
    </Card>
  );
}

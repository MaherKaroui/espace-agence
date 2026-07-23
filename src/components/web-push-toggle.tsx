import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Bell, BellOff, MonitorSmartphone } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getVapidPublicKey, savePushSubscription, deletePushSubscription } from "@/lib/push.functions";
import { toast } from "sonner";

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
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
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

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const { key } = await getKey();
      if (!key) { toast.error("Clé serveur indisponible"); return; }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
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
      toast.success("Notifications PC activées");
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
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await delSub({ data: { endpoint: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Notifications PC désactivées");
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
        <div className="text-sm text-muted-foreground">
          Ce navigateur ne prend pas en charge les notifications PC. Vous continuez à recevoir les alertes dans la cloche IZISuivis.
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        <MonitorSmartphone className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="font-medium">Notifications sur mon ordinateur</div>
          <div className="text-sm text-muted-foreground">
            Recevez les alertes IZISuivis directement sur votre bureau, même si l'onglet n'est pas ouvert.
          </div>
          {permission === "denied" && (
            <div className="text-xs text-destructive mt-1">
              Les notifications sont bloquées dans les paramètres du navigateur — autorisez-les puis rechargez la page.
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0">
        {subscribed ? (
          <Button variant="outline" onClick={disable} disabled={loading} className="gap-2">
            <BellOff className="h-4 w-4" /> Désactiver
          </Button>
        ) : (
          <Button onClick={enable} disabled={loading || permission === "denied"} className="gap-2">
            <Bell className="h-4 w-4" /> Activer notifications PC
          </Button>
        )}
      </div>
    </Card>
  );
}

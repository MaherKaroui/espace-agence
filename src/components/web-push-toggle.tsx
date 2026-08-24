import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Bell, BellOff, CheckCircle2, MonitorSmartphone, XCircle } from "lucide-react";
import { useWebPush } from "@/hooks/use-web-push";

export function WebPushToggle() {
  const { supported, permission, subscribed, loading, ready, platformHint, enable, disable } = useWebPush();

  const stateLabel = !supported
    ? "Non configuré"
    : permission === "denied"
      ? "Refusé"
      : subscribed && permission === "granted"
        ? "Activé"
        : "Non configuré";

  const stateClass =
    stateLabel === "Activé"
      ? "border-success/30 bg-success/10 text-success"
      : stateLabel === "Refusé"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-border bg-muted text-muted-foreground";

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
          {platformHint && (
            <div className="text-xs text-muted-foreground mt-1 rounded-md border border-border bg-muted/50 px-2 py-1.5">
              {platformHint}
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
          <Button variant="outline" onClick={() => void disable()} disabled={loading} className="gap-2">
            <BellOff className="h-4 w-4" /> Désactiver
          </Button>
        ) : (
          <Button onClick={() => void enable()} disabled={loading || permission === "denied" || !ready} className="gap-2">
            <Bell className="h-4 w-4" /> Activer les notifications navigateur
          </Button>
        )}
      </div>
    </Card>
  );
}

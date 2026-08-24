import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWebPush } from "@/hooks/use-web-push";

const DISMISS_KEY = "izisuivis.push.banner.dismissed";
/** Rappel forcé si l'utilisateur cumule beaucoup d'alertes non lues malgré un rejet. */
const REMIND_UNREAD_THRESHOLD = 15;

export function PushActivationBanner({ unreadCount = 0 }: { unreadCount?: number }) {
  const { supported, permission, subscribed, loading, ready, platformHint, enable } = useWebPush();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const hide = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setDismissed(true);
  };

  if (!supported || subscribed || permission === "denied") return null;
  if (dismissed && unreadCount < REMIND_UNREAD_THRESHOLD) return null;

  return (
    <Card className="border-gold/40 bg-gold/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <Bell className="h-5 w-5 text-gold shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">Activez les notifications sur cet appareil</div>
        <div className="text-sm text-muted-foreground">
          {unreadCount >= REMIND_UNREAD_THRESHOLD
            ? `Vous avez ${unreadCount} alertes non lues. Activez les notifications pour ne plus rien manquer.`
            : "Vous ne recevez aucune alerte lorsque IZISuivis n'est pas ouvert."}
        </div>
        {platformHint && (
          <div className="mt-1 rounded-md border border-border bg-background/60 px-2 py-1.5 text-xs text-muted-foreground">
            {platformHint}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" onClick={() => void enable()} disabled={loading || !ready} className="gap-2">
          <Bell className="h-4 w-4" /> Activer
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link to="/preferences">Réglages</Link>
        </Button>
        <Button size="sm" variant="ghost" onClick={hide} aria-label="Masquer">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

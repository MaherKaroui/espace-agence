import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bell, BellOff, BellRing, Check, MessageSquare, FileText, FolderOpen,
  Calendar, AlertTriangle, ClipboardCheck, Inbox, Settings,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { groupNotifications, type NotifRow } from "@/lib/notification-grouping";
import { cn } from "@/lib/utils";
import { notifTargetLink } from "@/lib/notif-link";
import { showBrowserNotif } from "@/lib/web-push";
import { useWebPush } from "@/hooks/use-web-push";

type TabKey = "unread" | "all";

const TYPE_ICONS: Record<string, { icon: any; color: string }> = {
  message: { icon: MessageSquare, color: "text-blue-600 dark:text-blue-400" },
  document_depose: { icon: FileText, color: "text-emerald-600 dark:text-emerald-400" },
  document_demande: { icon: FileText, color: "text-amber-600 dark:text-amber-400" },
  tache_attente: { icon: ClipboardCheck, color: "text-amber-600 dark:text-amber-400" },
  tache_assignee: { icon: ClipboardCheck, color: "text-primary" },
  rdv: { icon: Calendar, color: "text-purple-600 dark:text-purple-400" },
  statut_change: { icon: FolderOpen, color: "text-primary" },
  alerte: { icon: AlertTriangle, color: "text-destructive" },
  rapport_quotidien: { icon: Inbox, color: "text-muted-foreground" },
};

function iconFor(type: string) {
  return TYPE_ICONS[type] ?? { icon: Bell, color: "text-muted-foreground" };
}


export function NotificationsBell() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("unread");
  // Abonnement push : implémentation unique partagée (src/hooks/use-web-push.ts)
  const push = useWebPush();


  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications").select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      return (data ?? []) as NotifRow[];
    },
  });

  // Realtime + déclenche une notification navigateur sur nouvel INSERT.
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel(`notif-${user.id}-${Math.random().toString(36).slice(2)}`);
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
      (payload) => {
        qc.invalidateQueries({ queryKey: ["notifications", user.id] });
        const n = payload.new as NotifRow;
        if (n && !n.read_at) {
          showBrowserNotif({
            id: n.id,
            title: n.titre,
            body: n.message,
            link: n.link,
            tag: n.type,
          });
        }
      },
    );
    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
      () => qc.invalidateQueries({ queryKey: ["notifications", user.id] }),
    );
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, qc]);

  const permission: NotificationPermission | "unsupported" = push.supported ? push.permission : "unsupported";
  const enabled = push.subscribed && push.permission === "granted";


  const unreadNotifs = notifications.filter((n) => !n.read_at);
  const activeList = tab === "unread" ? unreadNotifs : notifications;
  const groups = groupNotifications(activeList);
  const unread = unreadNotifs.length;

  const byType = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of unreadNotifs) m[n.type] = (m[n.type] ?? 0) + 1;
    return m;
  }, [unreadNotifs]);

  const markAll = async () => {
    if (!user) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id).is("read_at", null);
    qc.invalidateQueries({ queryKey: ["notifications", user.id] });
  };

  const markGroup = async (ids: string[]) => {
    if (ids.length === 0) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
    qc.invalidateQueries({ queryKey: ["notifications", user?.id] });
  };

  // Délègue au hook partagé : correctif Safari + messages d'aide inclus.
  const togglePush = () => {
    if (!push.supported || push.loading) return;
    void (enabled ? push.disable() : push.enable());
  };


  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full bg-gold text-[10px] font-semibold text-primary flex items-center justify-center">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[26rem] p-0">
        <div className="p-3 border-b space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium">
              {unread > 0 ? `${unread} non lue${unread > 1 ? "s" : ""}` : "Notifications"}
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm" variant="ghost"
                onClick={togglePush}
                disabled={push.loading || permission === "unsupported" || permission === "denied" || (!enabled && !push.ready)}
                title={
                  permission === "unsupported" ? "Non supporté par ce navigateur"
                  : permission === "denied" ? "Notifications bloquées — autorisez-les dans le navigateur"
                  : enabled ? "Désactiver les alertes navigateur"
                  : "Activer les alertes navigateur"
                }
                className="gap-1.5"
              >
                {enabled ? <BellRing className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4" />}
                <span className="text-xs">
                  {push.loading ? "..." : permission === "denied" ? "Bloquées" : enabled ? "Push ON" : "Activer Push"}
                </span>
              </Button>
              <Button size="sm" variant="ghost" asChild className="gap-1" title="Préférences de notifications">
                <Link to="/preferences"><Settings className="h-4 w-4" /></Link>
              </Button>
              {unread > 0 && (
                <Button size="sm" variant="ghost" onClick={markAll} className="gap-1">
                  <Check className="h-4 w-4" /> Tout lu
                </Button>
              )}
            </div>
          </div>
          {!enabled && push.platformHint && (
            <div className="rounded-md border border-border bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
              {push.platformHint}
            </div>
          )}
          {permission === "denied" && (
            <div className="text-[11px] text-destructive">
              Notifications bloquées dans les réglages du navigateur — autorisez-les puis rechargez la page.
            </div>
          )}


          {/* Onglets */}
          <div className="inline-flex rounded-md border border-input overflow-hidden text-xs">
            <button
              type="button" onClick={() => setTab("unread")}
              className={cn("px-3 h-7", tab === "unread" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted/50")}
            >
              Non lues {unread > 0 && `(${unread})`}
            </button>
            <button
              type="button" onClick={() => setTab("all")}
              className={cn("px-3 h-7 border-l border-input", tab === "all" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted/50")}
            >
              Toutes
            </button>
          </div>

          {/* Résumé par type */}
          {unread > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(byType).map(([type, count]) => {
                const { icon: Icon, color } = iconFor(type);
                return (
                  <span key={type} className="inline-flex items-center gap-1 px-2 h-6 rounded-full bg-muted text-[11px]">
                    <Icon className={cn("h-3 w-3", color)} />
                    {count}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="max-h-[26rem] overflow-y-auto">
          {groups.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {tab === "unread" ? "Aucune notification non lue" : "Aucune notification"}
            </div>
          )}
          {groups.slice(0, 30).map((g) => {
            const { icon: Icon, color } = iconFor(g.type);
            return (
              <Link
                key={g.key} to={notifTargetLink(g.type, g.link)}
                onClick={() => g.unread && markGroup(g.unreadIds)}
                className={cn(
                  "flex items-start gap-3 px-4 py-3 border-b hover:bg-muted/50 transition-colors",
                  g.unread && "bg-accent/40",
                )}
              >
                <div className={cn("mt-0.5 h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0", color)}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium truncate">{g.titre}</div>
                    {g.count > 1 && (
                      <span className="shrink-0 h-5 min-w-5 px-1.5 rounded-full bg-gold text-[10px] font-semibold text-primary flex items-center justify-center">
                        {g.count}
                      </span>
                    )}
                  </div>
                  {g.message && (
                    <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{g.message}</div>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(g.latest_at), { addSuffix: true, locale: fr })}
                    </span>
                    {g.unread && <span className="h-1.5 w-1.5 rounded-full bg-gold" />}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="p-2 border-t bg-muted/30">
          <Link
            to="/notifications"
            className="block text-center text-xs text-primary hover:underline py-1"
          >
            Voir toutes les notifications →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

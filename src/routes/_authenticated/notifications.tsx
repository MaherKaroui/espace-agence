import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Bell } from "lucide-react";
import { groupNotifications, type NotifRow } from "@/lib/notification-grouping";
import { notifTargetLink } from "@/lib/notif-link";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({ meta: [{ title: "Notifications" }] }),
  component: NotifPage,
});

function NotifPage() {
  const { user, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const { data: notifications = [], isFetched } = useQuery({
    queryKey: ["notifications-all", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    placeholderData: (prev: NotifRow[] | undefined) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.from("notifications").select("*").eq("user_id", user!.id).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as NotifRow[];
    },
  });

  const groups = groupNotifications(notifications);

  const markAll = async () => {
    if (!user) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null);
    qc.invalidateQueries();
  };

  const markGroup = async (ids: string[]) => {
    if (ids.length === 0) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
    qc.invalidateQueries();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl">Notifications</h1>
          <p className="text-muted-foreground mt-1">Historique regroupé par type.</p>
        </div>
        <Button variant="outline" onClick={markAll}>Tout marquer lu</Button>
      </div>

      {authLoading || !isFetched ? (
        <div className="space-y-3" aria-busy="true" aria-label="Chargement des notifications">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="p-4">
              <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
              <div className="mt-3 h-3 w-2/3 rounded bg-muted animate-pulse" />
            </Card>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Card className="p-12 text-center">
          <Bell className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">Aucune notification.</p>
        </Card>
      ) : (
        <Card className="divide-y">
          {groups.map((g) => (
            <Link
              key={g.key} to={notifTargetLink(g.type, g.link)}
              onClick={() => g.unread && markGroup(g.unreadIds)}
              className={`block p-4 hover:bg-muted/30 ${g.unread ? "bg-accent/30" : ""}`}
            >
              <div className="flex items-start gap-3">
                <div className={`h-2 w-2 rounded-full mt-2 ${g.unread ? "bg-gold" : "bg-muted-foreground/30"}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-medium text-sm">{g.titre}</div>
                    {g.count > 1 && (
                      <span className="h-5 min-w-5 px-1.5 rounded-full bg-gold text-[10px] font-semibold text-primary flex items-center justify-center">
                        {g.count}
                      </span>
                    )}
                  </div>
                  {g.message && <div className="text-sm text-muted-foreground mt-0.5">{g.message}</div>}
                  <div className="text-xs text-muted-foreground mt-1">{formatDistanceToNow(new Date(g.latest_at), { addSuffix: true, locale: fr })}</div>
                </div>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}


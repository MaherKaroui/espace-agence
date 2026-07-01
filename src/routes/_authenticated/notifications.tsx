import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Bell } from "lucide-react";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({ meta: [{ title: "Notifications" }] }),
  component: NotifPage,
});

function NotifPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications-all", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("notifications").select("*").eq("user_id", user!.id).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const markAll = async () => {
    if (!user) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null);
    qc.invalidateQueries();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl">Notifications</h1>
          <p className="text-muted-foreground mt-1">Historique complet.</p>
        </div>
        <Button variant="outline" onClick={markAll}>Tout marquer lu</Button>
      </div>

      {notifications.length === 0 ? (
        <Card className="p-12 text-center">
          <Bell className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">Aucune notification.</p>
        </Card>
      ) : (
        <Card className="divide-y">
          {notifications.map((n) => (
            <Link key={n.id} to={n.link || "/dashboard"} className={`block p-4 hover:bg-muted/30 ${n.read_at ? "" : "bg-accent/30"}`}>
              <div className="flex items-start gap-3">
                <div className={`h-2 w-2 rounded-full mt-2 ${n.read_at ? "bg-muted-foreground/30" : "bg-gold"}`} />
                <div className="flex-1">
                  <div className="font-medium text-sm">{n.titre}</div>
                  {n.message && <div className="text-sm text-muted-foreground mt-0.5">{n.message}</div>}
                  <div className="text-xs text-muted-foreground mt-1">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: fr })}</div>
                </div>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

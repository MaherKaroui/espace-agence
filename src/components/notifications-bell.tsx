import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { groupNotifications, type NotifRow } from "@/lib/notification-grouping";

export function NotificationsBell() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications").select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as NotifRow[];
    },
  });

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notif-${user.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["notifications", user.id] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, qc]);

  const groups = groupNotifications(notifications);
  const unread = notifications.filter((n) => !n.read_at).length;

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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full bg-gold text-[10px] font-semibold text-primary flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between p-3 border-b">
          <div className="font-medium">Notifications</div>
          {unread > 0 && <Button size="sm" variant="ghost" onClick={markAll}>Tout marquer lu</Button>}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {groups.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">Aucune notification</div>
          )}
          {groups.slice(0, 20).map((g) => (
            <Link
              key={g.key} to={g.link || "/dashboard"}
              onClick={() => g.unread && markGroup(g.unreadIds)}
              className={`block px-4 py-3 border-b hover:bg-muted/50 ${g.unread ? "bg-accent/40" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium">{g.titre}</div>
                {g.count > 1 && (
                  <span className="shrink-0 h-5 min-w-5 px-1.5 rounded-full bg-gold text-[10px] font-semibold text-primary flex items-center justify-center">
                    {g.count}
                  </span>
                )}
              </div>
              {g.message && <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{g.message}</div>}
              <div className="text-[10px] text-muted-foreground mt-1">
                {formatDistanceToNow(new Date(g.latest_at), { addSuffix: true, locale: fr })}
              </div>
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}


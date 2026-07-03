import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { categoryOf, iconOf } from "@/lib/notification-types";

/**
 * Écoute temps réel des insertions dans public.notifications pour l'utilisateur courant,
 * filtre selon ses préférences, et affiche un toast in-app cliquable.
 * Anti-spam : regroupe les événements du même type reçus à moins de 4s d'écart.
 */
export function NotificationsRealtime() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const prefsRef = useRef<Record<string, boolean>>({});
  const recentRef = useRef<Record<string, number>>({});

  // Charger les préférences (une seule fois par session utilisateur)
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("notification_preferences")
        .select("event_type, enabled")
        .eq("user_id", user.id);
      const map: Record<string, boolean> = {};
      (data ?? []).forEach((r: any) => { map[r.event_type] = r.enabled; });
      prefsRef.current = map;
    })();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel(`notif-toast-${user.id}-${Math.random().toString(36).slice(2)}`);
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
      (payload) => {
        const n: any = payload.new;
        const cat = categoryOf(n.type);

        // Préférences : par défaut activé, désactivé uniquement si explicitement false
        if (prefsRef.current[cat] === false) return;

        // Anti-spam : ignorer les doublons du même type+link à < 15s
        const key = `${n.type}:${n.link ?? ""}`;
        const now = Date.now();
        if (recentRef.current[key] && now - recentRef.current[key] < 15000) return;
        recentRef.current[key] = now;

        const Icon = iconOf(n.type);
        toast(n.titre, {
          description: n.message,
          icon: <Icon className="h-4 w-4" />,
          action: n.link ? {
            label: "Ouvrir",
            onClick: () => nav({ to: n.link, replace: false }),
          } : undefined,
        });

        qc.invalidateQueries({ queryKey: ["notifications", user.id] });
        qc.invalidateQueries({ queryKey: ["notifications-all", user.id] });
        qc.invalidateQueries({ queryKey: ["nav-unread", user.id] });
      },
    );
    channel.subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, qc, nav]);

  return null;
}

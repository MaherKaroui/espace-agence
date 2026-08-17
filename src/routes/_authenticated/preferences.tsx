import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { EVENT_CATEGORIES, type EventCategory } from "@/lib/notification-types";
import { toast } from "sonner";
import { WebPushToggle } from "@/components/web-push-toggle";

export const Route = createFileRoute("/_authenticated/preferences")({
  head: () => ({ meta: [{ title: "Préférences de notifications" }] }),
  component: PreferencesPage,
});

function PreferencesPage() {
  const { user } = useAuth();
  const { isStaff } = useRole();
  const qc = useQueryClient();

  const { data: prefs = [] } = useQuery({
    queryKey: ["notif-prefs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("event_type, enabled")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const prefMap: Record<string, boolean> = {};
  prefs.forEach((p: any) => { prefMap[p.event_type] = p.enabled; });

  const toggle = useMutation({
    mutationFn: async ({ key, enabled }: { key: EventCategory; enabled: boolean }) => {
      const { error } = await supabase
        .from("notification_preferences")
        .upsert(
          { user_id: user!.id, event_type: key, enabled },
          { onConflict: "user_id,event_type" },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notif-prefs", user?.id] }),
    onError: (e: any) => toast.error(e.message),
  });

  const visible = EVENT_CATEGORIES.filter((c) => c.key !== "securite" || isStaff);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-3xl">Préférences de notifications</h1>
        <p className="text-muted-foreground mt-1">
          Choisissez les événements pour lesquels vous souhaitez recevoir une notification pop-up.
        </p>
      </div>
      <WebPushToggle />
      {isStaff && <GoogleDriveConnect />}

      <Card className="divide-y">
        {visible.map((c) => {
          const enabled = prefMap[c.key] !== false; // défaut activé
          return (
            <div key={c.key} className="p-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium">{c.label}</div>
                <div className="text-sm text-muted-foreground">{c.description}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs font-medium ${enabled ? "text-success" : "text-muted-foreground"}`}>
                  {enabled ? "Activé" : "Désactivé"}
                </span>
                <Switch
                  checked={enabled}
                  onCheckedChange={(v) => toggle.mutate({ key: c.key, enabled: v })}
                />
              </div>
            </div>
          );
        })}

      </Card>

      <p className="text-xs text-muted-foreground">
        L'historique complet reste consultable depuis la cloche même si les pop-up sont désactivées.
      </p>
    </div>
  );
}

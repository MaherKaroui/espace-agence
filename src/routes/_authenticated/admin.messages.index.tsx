import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { usePresence, PresenceAvatar, PresenceLabel } from "@/components/presence-indicator";
import { mentionsToPlainText } from "@/lib/mentions";

export const Route = createFileRoute("/_authenticated/admin/messages/")({
  head: () => ({ meta: [{ title: "Messagerie clients" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const ok = roles?.some((r) => ["admin","direction","manager","consultant"].includes(r.role));
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: AdminMessages,
});

function AdminMessages() {
  const { data: threads = [] } = useQuery({
    queryKey: ["admin-threads"],
    queryFn: async () => {
      const { data: profiles } = await supabase.from("profiles").select("*");
      const { data: msgs } = await supabase.from("messages").select("client_id, content, created_at, from_agence, read_at").order("created_at", { ascending: false });
      const map = new Map<string, any>();
      (msgs ?? []).forEach((m) => { if (!map.has(m.client_id)) map.set(m.client_id, m); });
      return (profiles ?? [])
        .map((p) => ({ ...p, last: map.get(p.id) }))
        .filter((t) => !!t.last)
        .sort((a, b) => {
          const at = a.last?.created_at ?? "";
          const bt = b.last?.created_at ?? "";
          return bt.localeCompare(at);
        });
    },
  });

  const { data: presence } = usePresence(threads.map((t: any) => t.id));

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Messagerie clients</h1>
      <Card className="divide-y">
        {threads.map((t: any) => {
          const p = presence?.get(t.id);
          return (
            <Link key={t.id} to="/admin/messages/$clientId" params={{ clientId: t.id }} className="flex items-center gap-3 p-4 hover:bg-muted/30">
              <PresenceAvatar online={p?.online}>
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center"><User className="h-5 w-5 text-primary" /></div>
              </PresenceAvatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium truncate">{`${t.prenom ?? ""} ${t.nom ?? ""}`.trim() || t.email || "Client sans nom"}</div>
                  <PresenceLabel row={p} />
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {t.last ? (t.last.from_agence ? "Vous : " : "") + (t.last.content || "Pièce jointe") : "Aucun message"}
                </div>
              </div>
              {t.last && <div className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(t.last.created_at), { addSuffix: true, locale: fr })}</div>}
            </Link>
          );
        })}
      </Card>
    </div>
  );
}

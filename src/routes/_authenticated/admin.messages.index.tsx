import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { usePresence, PresenceAvatar, PresenceLabel } from "@/components/presence-indicator";
import { mentionsToPlainText } from "@/lib/mentions";
import { useRole } from "@/hooks/use-role";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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
  const qc = useQueryClient();
  const { isAdmin } = useRole();
  const { user } = useAuth();
  const { data: threads = [] } = useQuery({
    queryKey: ["admin-threads"],
    queryFn: async () => {
      const { data: profiles } = await supabase.from("profiles").select("*");
      const { data: msgs } = await supabase.from("messages").select("client_id, content, created_at, from_agence, read_at, deleted_at").is("deleted_at", null).order("created_at", { ascending: false });
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

  const deleteThread = async (clientId: string) => {
    const { error } = await supabase
      .from("messages")
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
      .eq("client_id", clientId)
      .is("deleted_at", null);
    if (error) return toast.error(error.message);
    toast.success("Discussion supprimée");
    qc.invalidateQueries({ queryKey: ["admin-threads"] });
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Messagerie clients</h1>
      <Card className="divide-y">
        {threads.map((t: any) => {
          const p = presence?.get(t.id);
          const name = `${t.prenom ?? ""} ${t.nom ?? ""}`.trim() || t.email || "Client sans nom";
          return (
            <div key={t.id} className="flex items-center gap-3 p-4 hover:bg-muted/30">
              <Link to="/admin/messages/$clientId" params={{ clientId: t.id }} className="flex items-center gap-3 flex-1 min-w-0">
                <PresenceAvatar online={p?.online}>
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center"><User className="h-5 w-5 text-primary" /></div>
                </PresenceAvatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-medium truncate">{name}</div>
                    <PresenceLabel row={p} />
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {t.last ? (t.last.from_agence ? "Vous : " : "") + (mentionsToPlainText(t.last.content) || "Pièce jointe") : "Aucun message"}
                  </div>
                </div>
                {t.last && <div className="text-xs text-muted-foreground shrink-0">{formatDistanceToNow(new Date(t.last.created_at), { addSuffix: true, locale: fr })}</div>}
              </Link>
              {isAdmin && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label="Supprimer la discussion">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Supprimer la discussion avec {name} ?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Tous les messages échangés seront supprimés pour vous et pour le client. Cette action est enregistrée dans l'audit.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteThread(t.id)}>Supprimer</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Trash2, User, Volume2, VolumeX } from "lucide-react";
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
import { isNotifSoundMuted, setNotifSoundMuted, playNotifSound } from "@/lib/notif-sound";

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
  const [q, setQ] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);

  const { data: threads = [] } = useQuery({
    queryKey: ["admin-threads"],
    queryFn: async () => {
      const { data: profiles } = await supabase.from("profiles").select("*").is("archived_at", null);
      const { data: msgs } = await supabase
        .from("messages")
        .select("client_id, content, created_at, from_agence, read_at, deleted_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      const last = new Map<string, any>();
      const unread = new Map<string, number>();
      for (const m of (msgs ?? []) as any[]) {
        if (!last.has(m.client_id)) last.set(m.client_id, m);
        // Message client vers agence, non lu = à traiter
        if (!m.from_agence && !m.read_at) {
          unread.set(m.client_id, (unread.get(m.client_id) ?? 0) + 1);
        }
      }
      return (profiles ?? [])
        .map((p: any) => ({ ...p, last: last.get(p.id), unread: unread.get(p.id) ?? 0 }))
        .filter((t: any) => !!t.last)
        .sort((a: any, b: any) => (b.last?.created_at ?? "").localeCompare(a.last?.created_at ?? ""));
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

  const totalUnread = useMemo(
    () => (threads as any[]).reduce((sum, t) => sum + (t.unread ?? 0), 0),
    [threads],
  );
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (threads as any[]).filter((t) => {
      if (onlyUnread && !(t.unread > 0)) return false;
      if (!term) return true;
      const s = `${t.prenom ?? ""} ${t.nom ?? ""} ${t.email ?? ""} ${t.entreprise ?? ""}`.toLowerCase();
      return s.includes(term);
    });
  }, [threads, q, onlyUnread]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Messagerie clients</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {threads.length} discussion{threads.length > 1 ? "s" : ""}
            {totalUnread > 0 && <> · <span className="text-primary font-medium">{totalUnread} non lu{totalUnread > 1 ? "s" : ""}</span></>}
          </p>
        </div>
        <Button
          variant={onlyUnread ? "default" : "outline"}
          size="sm"
          onClick={() => setOnlyUnread((v) => !v)}
          className="gap-2"
        >
          Non lus {totalUnread > 0 && <Badge variant="secondary" className="ml-1">{totalUnread}</Badge>}
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
        <Input
          placeholder="Rechercher un client…"
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <Card className="divide-y">
        {filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {onlyUnread ? "Aucune discussion non lue." : "Aucune discussion."}
          </div>
        )}
        {filtered.map((t: any) => {
          const p = presence?.get(t.id);
          const name = `${t.prenom ?? ""} ${t.nom ?? ""}`.trim() || t.email || "Client sans nom";
          return (
            <div key={t.id} className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 hover:bg-muted/30">
              <Link to="/admin/messages/$clientId" params={{ clientId: t.id }} className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                <PresenceAvatar online={p?.online}>
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><User className="h-5 w-5 text-primary" /></div>
                </PresenceAvatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`truncate min-w-0 ${t.unread > 0 ? "font-semibold" : "font-medium"}`}>{name}</div>
                    <span className="hidden sm:inline"><PresenceLabel row={p} /></span>
                    {t.unread > 0 && (
                      <Badge className="h-5 min-w-5 px-1.5 rounded-full text-xs shrink-0">{t.unread}</Badge>
                    )}
                  </div>
                  <div className={`text-xs truncate ${t.unread > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                    {t.last ? (t.last.from_agence ? "Vous : " : "") + (mentionsToPlainText(t.last.content) || "Pièce jointe") : "Aucun message"}
                  </div>
                  {t.last && (
                    <div className="sm:hidden text-[11px] text-muted-foreground mt-0.5 truncate">
                      {formatDistanceToNow(new Date(t.last.created_at), { addSuffix: true, locale: fr })}
                    </div>
                  )}
                </div>
                {t.last && <div className="hidden sm:block text-xs text-muted-foreground shrink-0">{formatDistanceToNow(new Date(t.last.created_at), { addSuffix: true, locale: fr })}</div>}
              </Link>
              {isAdmin && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-destructive" aria-label="Supprimer la discussion">
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

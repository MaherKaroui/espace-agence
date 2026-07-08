import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Check, X, CalendarClock, CalendarCog, Search } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { LoadingState, EmptyState, ErrorState } from "@/components/state-views";


export const Route = createFileRoute("/_authenticated/admin/rendez-vous")({
  head: () => ({ meta: [{ title: "Rendez-vous — Admin" }] }),
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const ok = roles?.some((r) => ["admin","direction"].includes(r.role));
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: AdminRdv,
});

type Rdv = {
  id: string;
  client_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  notes: string | null;
  profiles?: { nom: string | null; prenom: string | null; email: string | null } | null;
};

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function AdminRdv() {
  const qc = useQueryClient();
  const [reschedule, setReschedule] = useState<Rdv | null>(null);
  const [newDate, setNewDate] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "en_attente" | "confirme" | "refuse" | "annule">("all");


  const { data: rdvs = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-rendez-vous"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rendez_vous")
        .select("id, client_id, starts_at, ends_at, status, notes")
        .order("starts_at", { ascending: true });
      if (error) throw error;
      const list = (data ?? []) as Rdv[];
      const ids = Array.from(new Set(list.map((r) => r.client_id)));
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles").select("id, nom, prenom, email").in("id", ids);
        const m = new Map((profs ?? []).map((p) => [p.id, p]));
        for (const r of list) {
          const p = m.get(r.client_id);
          if (p) r.profiles = { nom: p.nom, prenom: p.prenom, email: p.email };
        }
      }
      return list;
    },
  });

  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "confirme" | "refuse" | "annule" }) => {
      const { error } = await supabase.from("rendez_vous").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, v) => {
      toast.success(
        v.status === "confirme" ? "Rendez-vous accepté" :
        v.status === "refuse" ? "Rendez-vous refusé" : "Rendez-vous annulé"
      );
      qc.invalidateQueries({ queryKey: ["admin-rendez-vous"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const replan = useMutation({
    mutationFn: async ({ rdv, when }: { rdv: Rdv; when: string }) => {
      const start = new Date(when);
      if (isNaN(start.getTime())) throw new Error("Date invalide");
      const durMs = Math.max(15 * 60 * 1000, new Date(rdv.ends_at).getTime() - new Date(rdv.starts_at).getTime());
      const end = new Date(start.getTime() + durMs);
      const { error } = await supabase
        .from("rendez_vous")
        .update({ starts_at: start.toISOString(), ends_at: end.toISOString(), status: "confirme" })
        .eq("id", rdv.id);
      if (error) throw error;
      // Notification manuelle (le trigger ne se déclenche que sur changement de statut)
      const d_str = start.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
      await supabase.from("notifications").insert({
        user_id: rdv.client_id,
        type: "rdv" as any,
        titre: "Rendez-vous replanifié",
        message: `Votre rendez-vous a été replanifié au ${d_str}.`,
        link: "/rendez-vous",
      });
    },
    onSuccess: () => {
      toast.success("Rendez-vous replanifié");
      setReschedule(null);
      setNewDate("");
      qc.invalidateQueries({ queryKey: ["admin-rendez-vous"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const openReschedule = (r: Rdv) => {
    setReschedule(r);
    setNewDate(toLocalInput(r.starts_at));
  };

  const clientName = (r: Rdv) =>
    r.profiles ? `${r.profiles.prenom ?? ""} ${r.profiles.nom ?? ""}`.trim() || r.profiles.email || r.client_id
      : r.client_id;

  const matches = (r: Rdv) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (!q.trim()) return true;
    const name = clientName(r).toLowerCase();
    const email = (r.profiles?.email ?? "").toLowerCase();
    const s = q.toLowerCase();
    return name.includes(s) || email.includes(s);
  };

  const pending = rdvs.filter((r) => r.status === "en_attente").filter(matches);
  const upcoming = rdvs.filter((r) => r.status === "confirme" && new Date(r.starts_at) >= new Date()).filter(matches);
  const history = rdvs.filter((r) => !(r.status === "en_attente") && !(r.status === "confirme" && new Date(r.starts_at) >= new Date())).filter(matches);


  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
  const fmtHour = (iso: string) =>
    new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const fmtDay = (iso: string) =>
    new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });


  const statusLabel = (s: string) =>
    s === "en_attente" ? "En attente" :
    s === "confirme" ? "Confirmé" :
    s === "refuse" ? "Refusé" :
    s === "annule" ? "Annulé" : s;

  // Regroupement par jour pour les RDV à venir
  const upcomingByDay = (() => {
    const groups = new Map<string, Rdv[]>();
    for (const r of upcoming) {
      const key = new Date(r.starts_at).toDateString();
      const arr = groups.get(key) ?? [];
      arr.push(r);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).map(([key, items]) => ({ key, day: items[0].starts_at, items }));
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl flex items-center gap-2">
          <CalendarClock className="h-7 w-7 text-gold" /> Demandes de rendez-vous
        </h1>
        <p className="text-muted-foreground mt-1">Acceptez, refusez ou replanifiez les créneaux demandés par vos clients.</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-64">
          <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
          <Input className="pl-9" placeholder="Rechercher un client (nom, e-mail)…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            <SelectItem value="en_attente">En attente</SelectItem>
            <SelectItem value="confirme">Confirmés</SelectItem>
            <SelectItem value="refuse">Refusés</SelectItem>
            <SelectItem value="annule">Annulés</SelectItem>
          </SelectContent>
        </Select>
      </div>



      <section>
        <h2 className="font-medium mb-3">En attente ({pending.length})</h2>
        {isLoading ? (
          <div className="text-muted-foreground text-sm">Chargement…</div>
        ) : pending.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">Aucune demande en attente.</Card>
        ) : (
          <div className="grid gap-2">
            {pending.map((r) => (
              <Card key={r.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{fmt(r.starts_at)}</div>
                  <div className="text-xs text-muted-foreground">Client : {clientName(r)}</div>
                  {r.notes && <div className="text-sm mt-1 text-muted-foreground">« {r.notes} »</div>}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" disabled={decide.isPending}>
                        <X className="h-4 w-4 mr-1" /> Refuser
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Refuser ce rendez-vous ?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {clientName(r)} sera notifié·e que le créneau du {fmt(r.starts_at)} n'a pas été retenu.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction onClick={() => decide.mutate({ id: r.id, status: "refuse" })}>
                          Refuser
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button size="sm" variant="outline" onClick={() => openReschedule(r)}>
                    <CalendarCog className="h-4 w-4 mr-1" /> Replanifier
                  </Button>
                  <Button size="sm" onClick={() => decide.mutate({ id: r.id, status: "confirme" })} disabled={decide.isPending}>
                    <Check className="h-4 w-4 mr-1" /> Accepter
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-medium mb-3">Rendez-vous confirmés à venir ({upcoming.length})</h2>
        {upcoming.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">Aucun rendez-vous à venir.</Card>
        ) : (
          <div className="space-y-4">
            {upcomingByDay.map((g) => (
              <div key={g.key} className="space-y-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                  {fmtDay(g.day)} · {g.items.length} RDV
                </div>
                {g.items.map((r) => (
                  <Card key={r.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="rounded-md bg-primary/10 text-primary px-3 py-2 text-sm font-semibold shrink-0">
                        {fmtHour(r.starts_at)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{clientName(r)}</div>
                        <div className="text-xs text-muted-foreground">
                          → {fmtHour(r.ends_at)} {r.notes && <>· « {r.notes} »</>}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => openReschedule(r)}>
                        <CalendarCog className="h-4 w-4 mr-1" /> Replanifier
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" disabled={decide.isPending}>Annuler</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Annuler ce rendez-vous ?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {clientName(r)} sera notifié·e de l'annulation du {fmt(r.starts_at)}.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Ne pas annuler</AlertDialogCancel>
                            <AlertDialogAction onClick={() => decide.mutate({ id: r.id, status: "annule" })}>
                              Confirmer l'annulation
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </Card>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section>
          <h2 className="font-medium mb-3">Historique</h2>
          <div className="grid gap-2">
            {history.map((r) => (
              <Card key={r.id} className="p-3 flex items-center justify-between text-sm">
                <span>{fmt(r.starts_at)} — {clientName(r)}</span>
                <Badge variant="outline" className="text-xs">{statusLabel(r.status)}</Badge>
              </Card>
            ))}
          </div>
        </section>
      )}

      <Dialog open={!!reschedule} onOpenChange={(o) => { if (!o) { setReschedule(null); setNewDate(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replanifier le rendez-vous</DialogTitle>
            <DialogDescription>
              {reschedule && <>Client : {clientName(reschedule)} · Créneau actuel : {fmt(reschedule.starts_at)}</>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-date">Nouveau créneau</Label>
            <Input id="new-date" type="datetime-local" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReschedule(null); setNewDate(""); }}>Annuler</Button>
            <Button
              onClick={() => reschedule && newDate && replan.mutate({ rdv: reschedule, when: newDate })}
              disabled={!newDate || replan.isPending}
            >
              {replan.isPending ? "Enregistrement…" : "Confirmer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

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
import { Check, X, CalendarClock, CalendarCog } from "lucide-react";

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

  const { data: rdvs = [], isLoading } = useQuery({
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

  const pending = rdvs.filter((r) => r.status === "en_attente");
  const upcoming = rdvs.filter((r) => r.status === "confirme" && new Date(r.starts_at) >= new Date());
  const history = rdvs.filter((r) => !(r.status === "en_attente") && !(r.status === "confirme" && new Date(r.starts_at) >= new Date()));

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });

  const clientName = (r: Rdv) =>
    r.profiles ? `${r.profiles.prenom ?? ""} ${r.profiles.nom ?? ""}`.trim() || r.profiles.email || r.client_id
      : r.client_id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl flex items-center gap-2">
          <CalendarClock className="h-7 w-7 text-gold" /> Demandes de rendez-vous
        </h1>
        <p className="text-muted-foreground mt-1">Acceptez, refusez ou replanifiez les créneaux demandés par vos clients.</p>
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
                  <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: r.id, status: "refuse" })} disabled={decide.isPending}>
                    <X className="h-4 w-4 mr-1" /> Refuser
                  </Button>
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
          <div className="grid gap-2">
            {upcoming.map((r) => (
              <Card key={r.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{fmt(r.starts_at)}</div>
                  <div className="text-xs text-muted-foreground">Client : {clientName(r)}</div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => openReschedule(r)}>
                    <CalendarCog className="h-4 w-4 mr-1" /> Replanifier
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: r.id, status: "annule" })} disabled={decide.isPending}>
                    Annuler
                  </Button>
                </div>
              </Card>
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
                <span className="text-xs text-muted-foreground">{r.status}</span>
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

import { createFileRoute } from "@tanstack/react-router";
import { Fragment } from "react";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, CalendarCheck, CalendarCog } from "lucide-react";

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}


export const Route = createFileRoute("/_authenticated/rendez-vous")({
  component: RendezVousPage,
});

const HOURS = Array.from({ length: 9 }, (_, i) => 9 + i); // 9..17 (créneaux 9-10, ..., 17-18)
const DAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];

function startOfWeek(d: Date) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay(); // 0=dim
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtDate(d: Date) {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}
function slotDate(weekStart: Date, dayIdx: number, hour: number) {
  const d = addDays(weekStart, dayIdx);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function RendezVousPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [selected, setSelected] = useState<Date | null>(null);
  const [notes, setNotes] = useState("");
  type MineRdv = { id: string; starts_at: string; ends_at: string; status: string; notes: string | null };
  const [replan, setReplan] = useState<MineRdv | null>(null);
  const [replanDate, setReplanDate] = useState("");


  const weekEnd = useMemo(() => addDays(weekStart, 5), [weekStart]);

  const { data: taken = [], isLoading } = useQuery({
    queryKey: ["rendez_vous", weekStart.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rendez_vous")
        .select("id, starts_at, ends_at, client_id, status")
        .gte("starts_at", weekStart.toISOString())
        .lt("starts_at", weekEnd.toISOString())
        .not("status", "in", "(annule,refuse)");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: mine = [] } = useQuery({
    queryKey: ["rendez_vous-mine", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rendez_vous")
        .select("id, starts_at, ends_at, status, notes")
        .eq("client_id", user!.id)
        .gte("starts_at", new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString())
        .order("starts_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const takenSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of taken) s.add(new Date(r.starts_at).toISOString());
    return s;
  }, [taken]);

  const bookMutation = useMutation({
    mutationFn: async ({ start, notes }: { start: Date; notes: string }) => {
      if (!user) throw new Error("Non authentifié");
      const end = new Date(start);
      end.setHours(end.getHours() + 1);
      const { error } = await supabase.from("rendez_vous").insert({
        client_id: user.id,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        notes: notes || null,
        status: "en_attente",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Demande envoyée — en attente de validation par l'agence");
      qc.invalidateQueries({ queryKey: ["rendez_vous"] });
      qc.invalidateQueries({ queryKey: ["rendez_vous-mine"] });
      setSelected(null);
      setNotes("");
    },
    onError: (e: any) => {
      const msg = e?.message?.includes("rendez_vous_slot_unique")
        ? "Ce créneau vient d'être demandé, choisissez-en un autre."
        : e?.message ?? "Erreur";
      toast.error(msg);
    },
  });

  const replanMutation = useMutation({
    mutationFn: async ({ rdv, when }: { rdv: MineRdv; when: string }) => {
      const start = new Date(when);
      if (isNaN(start.getTime())) throw new Error("Date invalide");
      const durMs = Math.max(60 * 60 * 1000, new Date(rdv.ends_at).getTime() - new Date(rdv.starts_at).getTime());
      const end = new Date(start.getTime() + durMs);
      const { error } = await supabase
        .from("rendez_vous")
        .update({ starts_at: start.toISOString(), ends_at: end.toISOString(), status: "en_attente" })
        .eq("id", rdv.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nouveau créneau envoyé — en attente de validation");
      qc.invalidateQueries({ queryKey: ["rendez_vous"] });
      qc.invalidateQueries({ queryKey: ["rendez_vous-mine"] });
      setReplan(null);
      setReplanDate("");
    },
    onError: (e: any) => {
      const msg = e?.message?.includes("rendez_vous_slot_unique")
        ? "Ce créneau est déjà pris, choisissez-en un autre."
        : e?.message ?? "Erreur";
      toast.error(msg);
    },
  });

  const now = new Date();


  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Demander un rendez-vous</h1>
        <p className="text-muted-foreground mt-1">
          Créneaux du lundi au vendredi, 9h–18h. Sélectionnez un créneau libre : votre demande sera envoyée à l'agence pour validation.
        </p>
      </div>

      {mine.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="font-medium mb-2">Mes demandes récentes</h2>
          <ul className="divide-y">
            {mine.map((r) => {
              const canReplan = (r.status === "en_attente" || r.status === "confirme") && new Date(r.starts_at) > new Date();
              return (
                <li key={r.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <span>
                    {new Date(r.starts_at).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "long" })}
                    {" — "}
                    {new Date(r.starts_at).getHours()}h00
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={
                      "text-xs px-2 py-0.5 rounded-full " +
                      (r.status === "confirme" ? "bg-emerald-500/15 text-emerald-600" :
                       r.status === "refuse" ? "bg-red-500/15 text-red-600" :
                       r.status === "annule" ? "bg-muted text-muted-foreground" :
                       "bg-amber-500/15 text-amber-600")
                    }>
                      {r.status === "en_attente" ? "En attente"
                        : r.status === "confirme" ? "Accepté"
                        : r.status === "refuse" ? "Refusé"
                        : r.status === "annule" ? "Annulé" : r.status}
                    </span>
                    {canReplan && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setReplan(r); setReplanDate(toLocalInput(r.starts_at)); }}
                      >
                        <CalendarCog className="h-4 w-4 mr-1" /> Replanifier
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}

          </ul>
        </div>
      )}

      <div className="flex items-center justify-between rounded-lg border bg-card p-3">
        <Button variant="outline" size="sm" onClick={() => setWeekStart((w) => addDays(w, -7))}>
          <ChevronLeft className="h-4 w-4" /> Semaine précédente
        </Button>
        <div className="font-medium">
          Semaine du {fmtDate(weekStart)} au {fmtDate(addDays(weekStart, 4))}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            Aujourd'hui
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart((w) => addDays(w, 7))}>
            Semaine suivante <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <div className="grid grid-cols-[80px_repeat(5,minmax(120px,1fr))] min-w-[720px]">
          <div className="border-b border-r p-2 text-xs font-medium text-muted-foreground">Heure</div>
          {DAY_LABELS.map((label, i) => {
            const d = addDays(weekStart, i);
            return (
              <div key={label} className="border-b p-2 text-center">
                <div className="text-xs uppercase text-muted-foreground">{label}</div>
                <div className="text-sm font-medium">{fmtDate(d)}</div>
              </div>
            );
          })}

          {HOURS.map((h) => (
            <Fragment key={`row-${h}`}>
              <div className="border-r border-b p-2 text-xs text-muted-foreground">
                {String(h).padStart(2, "0")}h – {String(h + 1).padStart(2, "0")}h
              </div>
              {DAY_LABELS.map((_, dayIdx) => {
                const start = slotDate(weekStart, dayIdx, h);
                const iso = start.toISOString();
                const isPast = start.getTime() < now.getTime();
                const isTaken = takenSet.has(iso);
                const disabled = isPast || isTaken || isLoading;
                return (
                  <button
                    key={`${dayIdx}-${h}`}
                    type="button"
                    disabled={disabled}
                    onClick={() => setSelected(start)}
                    className={
                      "border-b border-l h-14 text-xs transition " +
                      (disabled
                        ? "bg-muted/40 text-muted-foreground/40 cursor-not-allowed"
                        : "bg-background hover:bg-gold/10 hover:text-foreground text-emerald-600 dark:text-emerald-400 font-medium")
                    }
                    title={disabled ? (isPast ? "Passé" : "Indisponible") : "Créneau libre"}
                  >
                    {disabled ? "—" : "Libre"}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5 text-gold" />
              Demander ce créneau
            </DialogTitle>
            <DialogDescription>
              {selected &&
                selected.toLocaleDateString("fr-FR", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              {selected && ` — ${selected.getHours()}h00 à ${selected.getHours() + 1}h00`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Motif ou notes (optionnel)</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex. Point de suivi du dossier…"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Annuler
            </Button>
            <Button
              disabled={bookMutation.isPending}
              onClick={() => selected && bookMutation.mutate({ start: selected, notes })}
            >
              {bookMutation.isPending ? "Envoi…" : "Envoyer la demande"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!replan} onOpenChange={(o) => { if (!o) { setReplan(null); setReplanDate(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarCog className="h-5 w-5 text-gold" />
              Replanifier le rendez-vous
            </DialogTitle>
            <DialogDescription>
              {replan && <>Créneau actuel : {new Date(replan.starts_at).toLocaleString("fr-FR", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}</>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="replan-date">Nouveau créneau</Label>
            <Input id="replan-date" type="datetime-local" value={replanDate} onChange={(e) => setReplanDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">La demande sera envoyée à l'agence pour validation.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReplan(null); setReplanDate(""); }}>Annuler</Button>
            <Button
              disabled={!replanDate || replanMutation.isPending}
              onClick={() => replan && replanDate && replanMutation.mutate({ rdv: replan, when: replanDate })}
            >
              {replanMutation.isPending ? "Envoi…" : "Envoyer la demande"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

  );
}

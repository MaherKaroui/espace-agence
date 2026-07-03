import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Circle, Clock, Lock, AlertCircle, User, Calendar } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const TACHE_STATUTS = [
  { value: "a_faire", label: "À faire", icon: Circle, tone: "bg-muted text-muted-foreground" },
  { value: "en_cours", label: "En cours", icon: Clock, tone: "bg-info/15 text-info" },
  { value: "en_attente_client", label: "En attente client", icon: AlertCircle, tone: "bg-warning/15 text-warning-foreground" },
  { value: "bloque", label: "Bloqué", icon: Lock, tone: "bg-destructive/15 text-destructive" },
  { value: "termine", label: "Terminé", icon: CheckCircle2, tone: "bg-success/15 text-success" },
  { value: "annule", label: "Annulé", icon: Circle, tone: "bg-muted text-muted-foreground line-through" },
] as const;

const statutMeta = (v: string) => TACHE_STATUTS.find((s) => s.value === v) ?? TACHE_STATUTS[0];

export function TasksPanel({ dossierId }: { dossierId: string }) {
  const { isAdmin, roles } = useRole();
  const isStaff = isAdmin || roles.some((r) => ["direction", "manager", "consultant"].includes(r));
  const qc = useQueryClient();

  const { data: taches = [], isLoading } = useQuery({
    queryKey: ["taches", dossierId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("taches")
        .select("*")
        .eq("dossier_id", dossierId)
        .order("ordre", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, statut }: { id: string; statut: string }) => {
      const { error } = await supabase.from("taches").update({ statut: statut as any }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tâche mise à jour");
      qc.invalidateQueries({ queryKey: ["taches", dossierId] });
      qc.invalidateQueries({ queryKey: ["dossier", dossierId] });
      qc.invalidateQueries({ queryKey: ["dossiers-mine"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <Card className="p-6 text-muted-foreground">Chargement des tâches…</Card>;
  if (taches.length === 0) return null;

  const done = taches.filter((t) => t.statut === "termine").length;

  // Côté client : afficher d'abord les étapes terminées, puis en cours, puis à faire.
  const statutRank = (s: string): number => {
    if (s === "termine") return 0;
    if (s === "en_cours" || s === "en_attente_client") return 1;
    if (s === "a_faire") return 2;
    if (s === "bloque") return 3;
    return 4;
  };
  const tachesAffichees = isStaff
    ? taches
    : [...taches].sort((a, b) => {
        const r = statutRank(a.statut) - statutRank(b.statut);
        if (r !== 0) return r;
        return (a.ordre ?? 0) - (b.ordre ?? 0);
      });

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-xl">
          {isStaff ? "Étapes du dossier" : "Où en est votre dossier ?"}{" "}
          <span className="text-muted-foreground text-sm font-sans">({done}/{taches.length})</span>
        </h2>
      </div>
      {!isStaff && (
        <p className="text-sm text-muted-foreground -mt-2 mb-4">
          Voici les grandes étapes. Vous n'avez rien à faire ici : l'agence les met à jour au fil de l'avancement.
        </p>
      )}
      <div className="space-y-2">
        {tachesAffichees.map((t, idx) => {
          const meta = statutMeta(t.statut);
          const Icon = meta.icon;
          const locked = t.verrouillee;
          return (
            <div
              key={t.id}
              className={`flex items-start gap-3 p-3 rounded-lg border ${locked ? "opacity-70 bg-muted/40" : "bg-background"}`}
            >
              <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${meta.tone}`}>
                {isStaff ? <Icon className="h-4 w-4" /> : <span className="text-sm font-medium">{idx + 1}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {isStaff && <span className="text-xs text-muted-foreground">Étape {t.ordre}</span>}
                  <span className="font-medium">{t.titre}</span>
                  {isStaff && t.cote_client && <Badge variant="outline" className="text-xs">Action client</Badge>}
                  {locked && (
                    <Badge variant="outline" className="text-xs">
                      <Lock className="h-3 w-3 mr-1" />
                      {isStaff ? "Verrouillée" : "Pas encore disponible"}
                    </Badge>
                  )}
                </div>

                {t.description && <p className="text-sm text-muted-foreground mt-1">{t.description}</p>}
                <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                  {t.date_echeance && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> Échéance {format(new Date(t.date_echeance), "d MMM yyyy", { locale: fr })}
                    </span>
                  )}
                  {t.assigne_id && <span className="flex items-center gap-1"><User className="h-3 w-3" /> Assignée</span>}
                </div>
              </div>
              <div className="shrink-0">
                {isStaff ? (
                  <Select
                    value={t.statut}
                    onValueChange={(v) => update.mutate({ id: t.id, statut: v })}
                    disabled={locked}
                  >
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TACHE_STATUTS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="outline" className={meta.tone}>{meta.label}</Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

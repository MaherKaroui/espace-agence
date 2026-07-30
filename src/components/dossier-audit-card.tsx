import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, ClipboardCheck, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  computeDossierHealth, TONE_STYLES,
  type HealthDoc, type HealthTache, type HealthDossier,
} from "@/lib/dossier-health";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

const SCORE_STYLES: Record<string, string> = {
  bon: "bg-success/15 text-success border-success/25",
  moyen: "bg-warning/15 text-warning-foreground border-warning/30",
  critique: "bg-destructive/15 text-destructive border-destructive/30",
};

export function DossierAuditCard({
  dossier, documents, taches,
}: {
  dossier: HealthDossier & { updated_at?: string | null };
  documents: HealthDoc[];
  taches: HealthTache[];
}) {
  const { data: linkedTask } = useQuery({
    queryKey: ["dossier-audit-task", dossier.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("agency_tasks")
        .select("id, title, status, priority, due_date, auto")
        .eq("dossier_id", dossier.id)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(1);
      return (data ?? [])[0] ?? null;
    },
  });

  const h = computeDossierHealth({ dossier, documents, taches, linkedTask: linkedTask as any });
  const tone = TONE_STYLES[h.tone];

  return (
    <Card className={cn("relative overflow-hidden p-5", tone.card)}>
      <span className={cn("absolute left-0 top-0 bottom-0 w-1", tone.bar)} aria-hidden />
      <div className="pl-2 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-gold" /> Audit complet
          </h3>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("text-xs capitalize", SCORE_STYLES[h.score])}>
              Santé : {h.score}
            </Badge>
            <Badge variant="outline" className={cn("text-xs", tone.badge)}>{h.toneLabel}</Badge>
          </div>
        </div>

        <div>
          <div className="flex items-end justify-between mb-1">
            <span className="text-xs text-muted-foreground">Avancement global calculé</span>
            <span className="text-lg font-display tabular-nums">{h.global}%</span>
          </div>
          <Progress value={h.global} />
          <div className="mt-2 grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
            <span>Documents ({h.docs.validated}/{h.docs.total}) : {h.breakdown.docs}/50</span>
            <span>Étapes ({h.steps.done}/{h.steps.total}) : {h.breakdown.steps}/30</span>
            <span>Statut : {h.breakdown.statut}/10</span>
            <span>Absence d'alerte bloquante : {h.breakdown.alertes}/10</span>
          </div>
          {h.manual !== h.global && (
            <p className="text-xs mt-2 text-muted-foreground">
              Saisi manuellement : <span className="font-medium text-foreground">{h.manual}%</span>
            </p>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 text-sm">
          <Line label="Documents validés" value={`${h.docs.validated}/${h.docs.total}`} />
          <Line label="Documents à vérifier" value={h.docs.toReview} warn={h.docs.toReview > 0} />
          <Line label="Documents manquants" value={h.docs.missing} warn={h.docs.missing > 0} />
          <Line label="Documents à corriger" value={h.docs.toFix} warn={h.docs.toFix > 0} />
          <Line label="Étapes terminées" value={`${h.steps.done}/${h.steps.total}`} />
          <Line
            label="Tâche liée"
            value={linkedTask ? (h.taskOverdue ? "En retard" : (linkedTask as any).status) : "Aucune"}
            warn={h.taskOverdue}
          />
          <Line
            label="Dernière activité"
            value={dossier.updated_at
              ? formatDistanceToNow(new Date(dossier.updated_at), { addSuffix: true, locale: fr })
              : "—"}
            warn={h.blocked}
          />
        </div>

        <div className="rounded-md border bg-background/60 p-3">
          <div className="text-xs text-muted-foreground mb-0.5">Prochaine action recommandée</div>
          <div className="text-sm font-medium">{h.nextAction}</div>
        </div>

        {h.anomalies.length > 0 ? (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Alertes qualité ({h.anomalies.length})
            </div>
            {h.anomalies.map((a) => (
              <div
                key={a.key}
                className={cn(
                  "flex items-start gap-2 rounded-md border p-2 text-sm",
                  a.severity === "critical"
                    ? "bg-destructive/10 border-destructive/30"
                    : "bg-warning/10 border-warning/30",
                )}
              >
                <AlertTriangle className={cn("h-4 w-4 mt-0.5 shrink-0",
                  a.severity === "critical" ? "text-destructive" : "text-warning-foreground")} />
                <div>
                  <div className="font-medium">{a.label}</div>
                  <div className="text-xs text-muted-foreground">{a.detail}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> Aucune anomalie détectée sur ce dossier.
          </div>
        )}

        <p className="text-[11px] text-muted-foreground flex items-start gap-1">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          Calcul : 50 % documents requis validés · 30 % étapes terminées · 10 % statut · 10 % absence d'alerte bloquante.
        </p>
      </div>
    </Card>
  );
}

function Line({ label, value, warn = false }: { label: string; value: any; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-dashed border-border/60 pb-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm tabular-nums", warn ? "text-destructive font-medium" : "font-medium")}>
        {value}
      </span>
    </div>
  );
}

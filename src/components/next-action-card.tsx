import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Clock, XCircle, ArrowRight, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeNextAction, type DocLite, type TacheLite } from "@/lib/next-action";

const ICONS = {
  refuse: XCircle,
  a_corriger: AlertTriangle,
  manquant: AlertTriangle,
  tache: Clock,
  attente_agence: Clock,
  aucune: CheckCircle2,
} as const;

const TONES: Record<string, string> = {
  destructive: "border-destructive/40 bg-destructive/5 text-destructive",
  warning: "border-warning/40 bg-warning/10 text-warning-foreground",
  info: "border-info/40 bg-info/5 text-info",
  muted: "border-border bg-muted/30 text-muted-foreground",
  success: "border-success/40 bg-success/5 text-success",
};

interface Props {
  categorie: string;
  documents: DocLite[];
  taches: TacheLite[];
  dossierStatut?: string;
  compact?: boolean;
}

function triggerUpload(key: string) {
  window.dispatchEvent(new CustomEvent("required-doc-upload", { detail: { key } }));
}

export function NextActionCard({ categorie, documents, taches, dossierStatut, compact }: Props) {
  const na = computeNextAction(categorie, documents, taches, dossierStatut);
  const Icon = ICONS[na.kind];
  const hasCta = !!na.primaryKey && !!na.primaryLabel;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm", TONES[na.tone])}>
        <Icon className="h-4 w-4 shrink-0" />
        <div className="flex-1 min-w-0 truncate">
          <span className="font-medium">{na.label}</span>
        </div>
        {na.kind !== "aucune" && na.kind !== "attente_agence" && <ArrowRight className="h-4 w-4 shrink-0" />}
      </div>
    );
  }

  return (
    <Card className={cn("p-5 border-l-4", TONES[na.tone])}>
      <div className="flex flex-wrap items-start gap-4">
        <Icon className="h-6 w-6 mt-1 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wider opacity-70">Prochaine action</div>
          <div className="font-medium text-lg mt-1">{na.label}</div>
          {na.detail && <div className="text-sm opacity-80 mt-1">{na.detail}</div>}
        </div>
        {hasCta && (
          <Button
            size="lg"
            onClick={() => triggerUpload(na.primaryKey!)}
            className="shrink-0"
          >
            <Upload className="h-4 w-4 mr-2" />
            Ajouter mon {na.primaryLabel}
          </Button>
        )}
      </div>
    </Card>
  );
}

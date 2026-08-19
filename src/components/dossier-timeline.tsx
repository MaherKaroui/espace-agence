import { Card } from "@/components/ui/card";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { FileText, CheckCircle2, FolderPlus, RefreshCw, Upload } from "lucide-react";

type Doc = {
  id: string;
  nom: string;
  created_at: string;
  from_agence?: boolean | null;
};
type Tache = {
  id: string;
  titre: string;
  statut: string;
  updated_at?: string | null;
};
type Dossier = {
  created_at?: string | null;
  updated_at?: string | null;
  statut?: string | null;
};

type Event = {
  key: string;
  at: Date;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  title: string;
  detail?: string;
};

export function DossierTimeline({
  dossier,
  documents,
  taches,
}: {
  dossier: Dossier;
  documents: Doc[];
  taches: Tache[];
}) {
  const events: Event[] = [];

  if (dossier.created_at) {
    events.push({
      key: `dossier-${dossier.created_at}`,
      at: new Date(dossier.created_at),
      icon: FolderPlus,
      tone: "bg-muted text-muted-foreground",
      title: "Dossier créé",
    });
  }

  for (const d of documents) {
    events.push({
      key: `doc-${d.id}`,
      at: new Date(d.created_at),
      icon: d.from_agence ? Upload : FileText,
      tone: d.from_agence ? "bg-info/15 text-info" : "bg-primary/10 text-primary",
      title: d.from_agence ? "Document envoyé par l'agence" : "Document déposé",
      detail: d.nom,
    });
  }

  for (const t of taches) {
    if (t.statut === "termine" && t.updated_at) {
      events.push({
        key: `tache-${t.id}`,
        at: new Date(t.updated_at),
        icon: CheckCircle2,
        tone: "bg-success/15 text-success",
        title: "Étape terminée",
        detail: t.titre,
      });
    }
  }

  if (dossier.updated_at && dossier.created_at && dossier.updated_at !== dossier.created_at) {
    events.push({
      key: `dossier-upd-${dossier.updated_at}`,
      at: new Date(dossier.updated_at),
      icon: RefreshCw,
      tone: "bg-muted text-muted-foreground",
      title: "Dossier mis à jour",
    });
  }

  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  const top = events.slice(0, 8);

  if (top.length === 0) return null;

  return (
    <Card className="p-6">
      <h2 className="font-display text-xl mb-4">Activité récente</h2>
      <ol className="relative space-y-4 border-l border-border pl-6">
        {top.map((e) => {
          const Icon = e.icon;
          return (
            <li key={e.key} className="relative">
              <span
                className={`absolute -left-[34px] flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-background ${e.tone}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="text-sm font-medium">{e.title}</div>
              {e.detail && <div className="text-sm text-muted-foreground truncate">{e.detail}</div>}
              <div className="text-xs text-muted-foreground mt-0.5">
                {formatDistanceToNow(e.at, { addSuffix: true, locale: fr })}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, ListChecks, HelpCircle, CheckCircle2 } from "lucide-react";

export type ClientActivity = {
  dossiersEnCours: number;
  dossiersTermines: number;
  tachesOuvertes: number;
  demandesEnAttente: number;
};

const EMPTY: ClientActivity = {
  dossiersEnCours: 0,
  dossiersTermines: 0,
  tachesOuvertes: 0,
  demandesEnAttente: 0,
};

const DOSSIER_TERMINE = ["termine", "valide"];
const TACHE_FERMEE = ["terminee"];

/**
 * Agrège, pour une liste de clients, l'état d'avancement de leurs dossiers,
 * leurs tâches agence ouvertes, les demandes Qualiopi en attente et les
 * documents à vérifier. Toutes les données sont récupérées en 4 requêtes.
 */
export function useClientsActivity(clientIds: string[]) {
  const ids = Array.from(new Set(clientIds.filter(Boolean))).sort();
  return useQuery({
    queryKey: ["conversation-activity", ids.join(",")],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const map = new Map<string, ClientActivity>();
      const get = (id: string) => {
        if (!map.has(id)) map.set(id, { ...EMPTY });
        return map.get(id)!;
      };

      const { data: dossiers } = await supabase
        .from("dossiers")
        .select("id, client_id, statut")
        .in("client_id", ids)
        .is("archived_at", null);

      const dossierToClient = new Map<string, string>();
      for (const d of (dossiers ?? []) as any[]) {
        dossierToClient.set(d.id, d.client_id);
        const a = get(d.client_id);
        if (DOSSIER_TERMINE.includes(d.statut)) a.dossiersTermines += 1;
        else a.dossiersEnCours += 1;
      }
      const dossierIds = [...dossierToClient.keys()];

      const { data: taches } = await supabase
        .from("agency_tasks")
        .select("id, client_id, dossier_id, status")
        .is("archived_at", null)
        .or(`client_id.in.(${ids.join(",")})${dossierIds.length ? `,dossier_id.in.(${dossierIds.join(",")})` : ""}`);
      for (const t of (taches ?? []) as any[]) {
        if (TACHE_FERMEE.includes(t.status)) continue;
        const cid = t.client_id ?? (t.dossier_id ? dossierToClient.get(t.dossier_id) : null);
        if (cid && ids.includes(cid)) get(cid).tachesOuvertes += 1;
      }

      if (dossierIds.length > 0) {
        const { data: demandes } = await supabase
          .from("qualiopi_requests")
          .select("id, dossier_id, statut")
          .in("dossier_id", dossierIds);
        for (const r of (demandes ?? []) as any[]) {
          if (["valide", "accepte", "clos", "annule"].includes(r.statut)) continue;
          const cid = dossierToClient.get(r.dossier_id);
          if (cid) get(cid).demandesEnAttente += 1;
        }

      }

      return map;
    },
  });
}

export function mergeActivity(list: (ClientActivity | undefined)[]): ClientActivity {
  return list.reduce<ClientActivity>((acc, a) => {
    if (!a) return acc;
    return {
      dossiersEnCours: acc.dossiersEnCours + a.dossiersEnCours,
      dossiersTermines: acc.dossiersTermines + a.dossiersTermines,
      tachesOuvertes: acc.tachesOuvertes + a.tachesOuvertes,
      demandesEnAttente: acc.demandesEnAttente + a.demandesEnAttente,
    };
  }, { ...EMPTY });
}

/** Puces compactes affichées à côté d'une conversation. */
export function ActivityBadges({
  activity,
  className = "",
}: {
  activity?: ClientActivity;
  className?: string;
}) {
  if (!activity) return null;
  const { dossiersEnCours, dossiersTermines, tachesOuvertes, demandesEnAttente } = activity;
  const total = dossiersEnCours + dossiersTermines;
  if (total === 0 && tachesOuvertes === 0 && demandesEnAttente === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {dossiersEnCours > 0 && (
        <Badge variant="outline" className="gap-1 text-[10px] font-medium" title="Dossiers en cours">
          <FolderOpen className="h-3 w-3" /> {dossiersEnCours} en cours
        </Badge>
      )}
      {dossiersTermines > 0 && (
        <Badge variant="outline" className="gap-1 text-[10px] font-medium text-success border-success/30" title="Dossiers terminés">
          <CheckCircle2 className="h-3 w-3" /> {dossiersTermines} terminé{dossiersTermines > 1 ? "s" : ""}
        </Badge>
      )}
      {tachesOuvertes > 0 && (
        <Badge variant="outline" className="gap-1 text-[10px] font-medium" title="Tâches agence ouvertes">
          <ListChecks className="h-3 w-3" /> {tachesOuvertes} tâche{tachesOuvertes > 1 ? "s" : ""}
        </Badge>
      )}
      {demandesEnAttente > 0 && (
        <Badge variant="outline" className="gap-1 text-[10px] font-medium text-warning-foreground border-warning/40" title="Demandes Qualiopi en attente">
          <HelpCircle className="h-3 w-3" /> {demandesEnAttente} demande{demandesEnAttente > 1 ? "s" : ""}
        </Badge>
      )}
    </div>
  );
}

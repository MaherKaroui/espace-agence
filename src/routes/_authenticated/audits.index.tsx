import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, FolderOpen, ArrowRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { listMyAssignedDossiers } from "@/lib/dossier-assignments.functions";
import { StatusBadge } from "@/components/status-badge";
import { categorieLabel } from "@/lib/labels";
import { roleLabelFr } from "@/lib/role-labels";

export const Route = createFileRoute("/_authenticated/audits/")({
  head: () => ({ meta: [{ title: "Espace Auditeur / Certificateur — IZISuivis" }] }),
  component: AuditsIndex,
});

function AuditsIndex() {
  const listFn = useServerFn(listMyAssignedDossiers);
  const { data = [], isLoading } = useQuery({
    queryKey: ["my-assigned-dossiers"],
    queryFn: () => listFn(),
  });

  const rows = data as any[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          Mes dossiers affectés
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Dossiers Qualiopi sur lesquels vous intervenez comme auditeur ou certificateur.
        </p>
      </div>

      {isLoading && <Card className="p-4 text-sm text-muted-foreground">Chargement…</Card>}

      {!isLoading && rows.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <FolderOpen className="h-8 w-8 mx-auto mb-3 opacity-60" />
          Vous n'êtes affecté à aucun dossier pour le moment.
        </Card>
      )}

      <div className="grid gap-3">
        {rows.map((r) => (
          <Link
            key={r.assignment_id}
            to="/audits/$id"
            params={{ id: r.dossier.id }}
            className="block"
          >
            <Card className="p-4 hover:border-primary/40 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline">{roleLabelFr(r.role)}</Badge>
                    <span className="text-[11px] uppercase tracking-wider text-gold font-medium">
                      {categorieLabel(r.dossier.categorie)}
                    </span>
                    <StatusBadge statut={r.dossier.statut} />
                  </div>
                  <div className="font-display text-base truncate">{r.dossier.titre}</div>
                  {r.dossier.organisme_nom && (
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      OF : {r.dossier.organisme_nom}
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Affecté {formatDistanceToNow(new Date(r.assigned_at), { addSuffix: true, locale: fr })}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Plus, Settings } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PcFilters, PC_FILTERS_DEFAULT, applyPcFilters, type PcFilterValues } from "@/components/pole-certification/pc-filters";
import { PcLegend } from "@/components/pole-certification/pc-status";
import { NewPcDossierDialog } from "@/components/pole-certification/new-dossier-dialog";
import { usePcAll, usePcProfiles } from "@/components/pole-certification/use-pc";
import { PcDashboard } from "@/components/pole-certification/pc-dashboard";
import { PcTableView } from "@/components/pole-certification/pc-table-view";
import { PcKanban } from "@/components/pole-certification/pc-kanban";
import { PcCalendar } from "@/components/pole-certification/pc-calendar";

const VUES = ["tableau-de-bord", "tableau", "kanban", "calendrier"] as const;
type Vue = (typeof VUES)[number];

export const Route = createFileRoute("/_authenticated/pole-certification/")({
  head: () => ({ meta: [{ title: "Pôle Certification & EDOF" }] }),
  validateSearch: z.object({ vue: z.enum(VUES).optional() }),
  component: PoleCertificationPage,
});

function PoleCertificationPage() {
  const { vue = "tableau-de-bord" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { isStaff, isDirectionOrAdmin } = useRole();
  const { data, isLoading, error } = usePcAll();
  const [filters, setFilters] = useState<PcFilterValues>(PC_FILTERS_DEFAULT);
  const [creating, setCreating] = useState(false);

  const dossiers = useMemo(() => data?.dossiers ?? [], [data]);
  const etapes = useMemo(() => data?.etapes ?? [], [data]);
  const documents = useMemo(() => data?.documents ?? [], [data]);
  const profiles = usePcProfiles(dossiers.map((d) => d.responsable_id));
  const filtered = useMemo(() => applyPcFilters(filters, dossiers, etapes, documents), [filters, dossiers, etapes, documents]);
  const viewProps = { dossiers: filtered, etapes, documents, membres: data?.membres ?? [], profiles };
  const setVue = (v: Vue) => navigate({ search: { vue: v }, replace: true });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-display text-3xl md:text-4xl leading-tight tracking-[-0.01em]">Certification &amp; EDOF</h1>
          <p className="text-sm text-muted-foreground max-w-prose">
            Démarches auprès des certificateurs (titres RS) et référencements EDOF auprès de la Caisse des Dépôts.
          </p>
        </div>
        <div className="flex gap-2">
          {isDirectionOrAdmin && (
            <Button asChild variant="ghost" size="sm"><Link to="/pole-certification/parametres"><Settings className="h-4 w-4 mr-1.5" />Paramètres</Link></Button>
          )}
          {isStaff && <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1.5" />Nouveau dossier</Button>}
        </div>
      </header>

      {error ? (
        <Card className="p-6 text-sm text-destructive">Impossible de charger les dossiers : {(error as any).message}. Rechargez la page ; si l'erreur persiste, prévenez l'administrateur.</Card>
      ) : isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Chargement des dossiers…</Card>
      ) : dossiers.length === 0 ? (
        <Card className="p-8 md:p-10 max-w-2xl">
          <h2 className="font-display text-2xl">Aucun dossier pour l'instant</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-prose">
            Un dossier suit une démarche : un titre RS chez un certificateur, ou un référencement EDOF auprès de la Caisse des Dépôts.
            Les étapes par défaut, les rappels et les échéances sont créés automatiquement.
          </p>
          <div className="flex flex-wrap gap-2 mt-5">
            {isStaff && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1.5" />Créer un dossier</Button>}
            {isDirectionOrAdmin && (
              <Button asChild variant="outline"><Link to="/pole-certification/parametres">Créer les dossiers de démonstration</Link></Button>
            )}
          </div>
        </Card>
      ) : (
        <Tabs value={vue} onValueChange={(v) => setVue(v as Vue)} className="space-y-4">
          <div className="space-y-3">
            <TabsList className="w-fit sm:justify-start">
              <TabsTrigger value="tableau-de-bord">Tableau de bord</TabsTrigger>
              <TabsTrigger value="tableau">Tableau</TabsTrigger>
              <TabsTrigger value="kanban">Colonnes</TabsTrigger>
              <TabsTrigger value="calendrier">Calendrier</TabsTrigger>
            </TabsList>
            <PcFilters value={filters} onChange={setFilters} dossiers={dossiers} profiles={profiles} />
            {(vue === "kanban" || vue === "calendrier") && <PcLegend />}
          </div>
          <TabsContent value="tableau-de-bord" className="mt-0">
            <PcDashboard {...viewProps} onPickStatut={(statut) => { setFilters({ ...filters, statut }); setVue("tableau"); }} />
          </TabsContent>
          <TabsContent value="tableau" className="mt-0"><PcTableView {...viewProps} /></TabsContent>
          <TabsContent value="kanban" className="mt-0"><PcKanban {...viewProps} /></TabsContent>
          <TabsContent value="calendrier" className="mt-0"><PcCalendar {...viewProps} /></TabsContent>
        </Tabs>
      )}

      <NewPcDossierDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

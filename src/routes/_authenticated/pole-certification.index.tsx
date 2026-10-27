import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Award, Plus, Settings } from "lucide-react";
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-gold">Pôle</p>
          <h1 className="font-display text-2xl md:text-3xl flex items-center gap-2"><Award className="h-6 w-6" /> Certification &amp; EDOF</h1>
          <p className="text-sm text-muted-foreground">Démarches auprès des certificateurs (titres RS) et référencements EDOF auprès de la Caisse des Dépôts.</p>
        </div>
        <div className="flex gap-2">
          {isDirectionOrAdmin && (
            <Button asChild variant="outline" size="sm"><Link to="/pole-certification/parametres"><Settings className="h-4 w-4 mr-1" /> Paramètres</Link></Button>
          )}
          {isStaff && <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1" /> Nouveau dossier</Button>}
        </div>
      </div>

      <Card className="p-3 space-y-3">
        <PcFilters value={filters} onChange={setFilters} dossiers={dossiers} profiles={profiles} />
        <PcLegend />
      </Card>

      {error ? (
        <Card className="p-6 text-sm text-destructive">Impossible de charger les dossiers : {(error as any).message}</Card>
      ) : isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Chargement…</Card>
      ) : (
        <Tabs value={vue} onValueChange={(v) => navigate({ search: { vue: v as (typeof VUES)[number] }, replace: true })}>
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="tableau-de-bord">Tableau de bord</TabsTrigger>
            <TabsTrigger value="tableau">Tableau</TabsTrigger>
            <TabsTrigger value="kanban">Colonnes</TabsTrigger>
            <TabsTrigger value="calendrier">Calendrier</TabsTrigger>
          </TabsList>
          <TabsContent value="tableau-de-bord"><PcDashboard {...viewProps} /></TabsContent>
          <TabsContent value="tableau"><PcTableView {...viewProps} /></TabsContent>
          <TabsContent value="kanban"><PcKanban {...viewProps} /></TabsContent>
          <TabsContent value="calendrier"><PcCalendar {...viewProps} /></TabsContent>
        </Tabs>
      )}

      <NewPcDossierDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

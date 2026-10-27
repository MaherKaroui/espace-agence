import { SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  PC_STATUTS, personName, dossierState,
  type PcDossier, type PcEtape, type PcDocument, type PcProfile,
} from "@/lib/pole-certification";

export interface PcFilterValues {
  type: string;          // "all" | PcType
  responsable: string;   // "all" | user id
  statut: string;        // "all" | PcStatut | "termine" | "retard"
  certificateur: string; // "all" | nom
  du: string;            // période (date de création ou prochaine échéance)
  au: string;
  archives: boolean;
}
export const PC_FILTERS_DEFAULT: PcFilterValues = { type: "all", responsable: "all", statut: "all", certificateur: "all", du: "", au: "", archives: false };

/** Filtres communs aux quatre vues (§8). */
export function applyPcFilters(f: PcFilterValues, dossiers: PcDossier[], etapes: PcEtape[], docs: PcDocument[]) {
  return dossiers.filter((d) => {
    if (!f.archives && d.archived_at) return false;
    if (f.type !== "all" && d.type !== f.type) return false;
    if (f.responsable !== "all" && d.responsable_id !== f.responsable) return false;
    if (f.certificateur !== "all" && (d.certificateur ?? "") !== f.certificateur) return false;
    if (f.statut !== "all" || f.du || f.au) {
      const s = dossierState(d, etapes, docs);
      if (f.statut === "retard" ? !s.enRetard : f.statut !== "all" && s.statut !== f.statut) return false;
      const ref = s.prochaineEcheance ?? d.created_at.slice(0, 10);
      if (f.du && ref < f.du) return false;
      if (f.au && ref > f.au) return false;
    }
    return true;
  });
}

export function PcFilters({
  value, onChange, dossiers, profiles,
}: { value: PcFilterValues; onChange: (v: PcFilterValues) => void; dossiers: PcDossier[]; profiles: Map<string, PcProfile> }) {
  const set = (patch: Partial<PcFilterValues>) => onChange({ ...value, ...patch });
  const responsables = Array.from(new Set(dossiers.map((d) => d.responsable_id)));
  const certificateurs = Array.from(new Set(dossiers.map((d) => d.certificateur).filter(Boolean) as string[])).sort();
  const extra = (value.certificateur !== "all" ? 1 : 0) + (value.du || value.au ? 1 : 0) + (value.archives ? 1 : 0);
  const active = JSON.stringify(value) !== JSON.stringify(PC_FILTERS_DEFAULT);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs value={value.type} onValueChange={(v) => set({ type: v })}>
        <TabsList aria-label="Type de dossier">
          <TabsTrigger value="all">Tous</TabsTrigger>
          <TabsTrigger value="certificateur">Certificateur</TabsTrigger>
          <TabsTrigger value="edof">EDOF</TabsTrigger>
        </TabsList>
      </Tabs>

      <Select value={value.responsable} onValueChange={(v) => set({ responsable: v })}>
        <SelectTrigger aria-label="Responsable" className="h-9 w-auto min-w-[11rem]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les responsables</SelectItem>
          {responsables.map((id) => <SelectItem key={id} value={id}>{personName(profiles.get(id))}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={value.statut} onValueChange={(v) => set({ statut: v })}>
        <SelectTrigger aria-label="Statut" className="h-9 w-auto min-w-[10rem]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les statuts</SelectItem>
          {PC_STATUTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          <SelectItem value="retard">Échéance dépassée</SelectItem>
          <SelectItem value="termine">Terminé</SelectItem>
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-9">
            <SlidersHorizontal className="h-4 w-4 mr-1.5" />
            Plus de filtres{extra > 0 && <span className="ml-1.5 rounded-full bg-primary text-primary-foreground px-1.5 text-xs tabular-nums">{extra}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3">
          <div className="grid gap-1.5">
            <Label>Certificateur</Label>
            <Select value={value.certificateur} onValueChange={(v) => set({ certificateur: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les certificateurs</SelectItem>
                {certificateurs.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Prochaine échéance entre</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" aria-label="Du" value={value.du} onChange={(e) => set({ du: e.target.value })} />
              <Input type="date" aria-label="Au" value={value.au} onChange={(e) => set({ au: e.target.value })} />
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            Afficher les dossiers archivés
            <Switch checked={value.archives} onCheckedChange={(v) => set({ archives: v })} />
          </label>
        </PopoverContent>
      </Popover>

      {active && (
        <Button type="button" variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={() => onChange(PC_FILTERS_DEFAULT)}>
          Réinitialiser
        </Button>
      )}
    </div>
  );
}

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  return (
    <div className="grid gap-2 grid-cols-2 md:grid-cols-4 xl:grid-cols-7 items-end">
      <Select value={value.type} onValueChange={(v) => set({ type: v })}>
        <SelectTrigger aria-label="Type"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les types</SelectItem>
          <SelectItem value="certificateur">Certificateur</SelectItem>
          <SelectItem value="edof">EDOF</SelectItem>
        </SelectContent>
      </Select>
      <Select value={value.responsable} onValueChange={(v) => set({ responsable: v })}>
        <SelectTrigger aria-label="Responsable"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les responsables</SelectItem>
          {responsables.map((id) => <SelectItem key={id} value={id}>{personName(profiles.get(id))}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={value.statut} onValueChange={(v) => set({ statut: v })}>
        <SelectTrigger aria-label="Statut"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les statuts</SelectItem>
          {PC_STATUTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          <SelectItem value="retard">Échéance dépassée</SelectItem>
          <SelectItem value="termine">Terminé</SelectItem>
        </SelectContent>
      </Select>
      <Select value={value.certificateur} onValueChange={(v) => set({ certificateur: v })}>
        <SelectTrigger aria-label="Certificateur"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les certificateurs</SelectItem>
          {certificateurs.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input type="date" aria-label="Période du" value={value.du} onChange={(e) => set({ du: e.target.value })} />
      <Input type="date" aria-label="Période au" value={value.au} onChange={(e) => set({ au: e.target.value })} />
      <div className="flex gap-2 col-span-2 md:col-span-1">
        <Button type="button" variant={value.archives ? "secondary" : "outline"} size="sm" className="flex-1" onClick={() => set({ archives: !value.archives })}>
          {value.archives ? "Avec archives" : "Sans archives"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(PC_FILTERS_DEFAULT)}>Réinitialiser</Button>
      </div>
    </div>
  );
}

import type { PcDocument, PcDossier, PcEtape, PcMembre, PcProfile } from "@/lib/pole-certification";

/** Props communes aux quatre vues du pôle (dossiers déjà filtrés). */
export interface PcViewProps {
  dossiers: PcDossier[];
  etapes: PcEtape[];
  documents: PcDocument[];
  membres: PcMembre[];
  profiles: Map<string, PcProfile>;
}

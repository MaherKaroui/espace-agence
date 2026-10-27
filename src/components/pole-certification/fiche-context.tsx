import { useQueryClient } from "@tanstack/react-query";
import type {
  PcDossier, PcEtape, PcDocument, PcFichier, PcMembre, PcPieceType, PcProfile,
} from "@/lib/pole-certification";
import { PC_ALL_KEY } from "./use-pc";

/** Données et droits de la fiche, transmis aux panneaux. */
export interface FicheCtx {
  dossier: PcDossier;
  etapes: PcEtape[];          // toutes les tentatives du dossier
  documents: PcDocument[];
  fichiers: PcFichier[];
  membres: PcMembre[];
  pieceTypes: PcPieceType[];
  profiles: Map<string, PcProfile>;
  staff: PcProfile[];
  uid: string;
  canWrite: boolean;
  isAdmin: boolean;           // admin ou direction
}

export const ficheKey = (id: string) => ["pc-dossier", id] as const;

export function useFicheRefresh(id: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ficheKey(id) });
    qc.invalidateQueries({ queryKey: PC_ALL_KEY });
  };
}

/** Message lisible depuis une erreur Supabase / Postgres. */
export function errMsg(e: any) {
  const m = e?.message ?? String(e ?? "Erreur");
  if (/row-level security|violates row-level/i.test(m)) return "Action non autorisée pour votre rôle (ou dossier archivé).";
  if (/pc_etapes_motif_refus/.test(m)) return "Le motif du refus est obligatoire.";
  return m;
}

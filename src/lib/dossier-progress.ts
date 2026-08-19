// Source unique de vérité de l'avancement d'un dossier.
// L'avancement dépend UNIQUEMENT des étapes du dossier (3 étapes) :
//   avancement = (étapes terminées / 3) × 100
// Les documents n'entrent JAMAIS dans ce calcul.

export const ETAPES_TOTAL = 3;

export type EtapeLite = {
  id?: string;
  titre?: string;
  statut: string;
  updated_at?: string | null;
  completed_at?: string | null;
};

/** Étapes réellement prises en compte (les étapes annulées sont ignorées). */
export function etapesActives<T extends { statut: string }>(taches: T[] | null | undefined): T[] {
  const arr = Array.isArray(taches) ? taches : [];
  return arr.filter((t) => t.statut !== "annule");
}

/** Nombre d'étapes terminées, plafonné à 3. */
export function etapesTerminees(taches: EtapeLite[]): number {
  const done = etapesActives(taches ?? []).filter((t) => t.statut === "termine").length;
  return Math.min(ETAPES_TOTAL, done);
}

/**
 * Avancement 0-100 d'un dossier. Un dossier terminé/validé est toujours à 100 %.
 */
export function computeAvancement(taches: EtapeLite[], dossierStatut?: string | null): number {
  if (dossierStatut === "termine" || dossierStatut === "valide") return 100;
  const done = etapesTerminees(taches ?? []);
  return Math.round((done / ETAPES_TOTAL) * 100);
}

/** Libellé unique affiché partout : « Étapes du dossier (X/3) ». */
export function etapesLabel(taches: EtapeLite[]): string {
  return `Étapes du dossier (${etapesTerminees(taches ?? [])}/${ETAPES_TOTAL})`;
}

/** Variante à partir d'un pourcentage déjà calculé (exports, e-mails, rapports). */
export function etapesLabelFromPercent(avancement: number | null | undefined): string {
  const pct = Math.max(0, Math.min(100, Math.round(avancement ?? 0)));
  const done = Math.round((pct / 100) * ETAPES_TOTAL);
  return `Étapes du dossier (${done}/${ETAPES_TOTAL})`;
}

/** Normalise n'importe quelle source (objet, null, undefined…) en tableau sûr. */
export function toTaches<T = any>(taches: unknown): T[] {
  if (Array.isArray(taches)) return taches as T[];
  if (taches && typeof taches === "object") {
    const values = Object.values(taches as Record<string, unknown>);
    // Jointure Supabase renvoyée en objet unique -> on l'enveloppe.
    if (values.length && values.every((v) => v && typeof v === "object" && !Array.isArray(v))) {
      return values as T[];
    }
    if ("statut" in (taches as any)) return [taches as T];
  }
  return [];
}

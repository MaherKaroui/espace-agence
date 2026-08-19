// Calcul de la « prochaine action » côté client pour un dossier.
// Depuis la suppression de la vérification des fichiers, seule la PRÉSENCE
// d'un document compte : un fichier envoyé remplit son emplacement.

import { requiredDocsFor, docMatches } from "@/lib/labels";

export type DocLite = {
  id: string;
  nom: string;
  detected_type?: string | null;
};

export type TacheLite = {
  id: string;
  titre: string;
  statut: string;
  cote_client?: boolean | null;
  verrouillee?: boolean | null;
};

export type NextAction = {
  kind: "manquant" | "tache" | "attente_agence" | "aucune";
  label: string;
  detail?: string;
  tone: "destructive" | "warning" | "info" | "muted" | "success";
  /** Clé du document requis à traiter en priorité (pour le bouton CTA). */
  primaryKey?: string;
  /** Libellé lisible du document à traiter en priorité. */
  primaryLabel?: string;
};

export function computeNextAction(
  categorie: string,
  documents: DocLite[],
  taches: TacheLite[],
  dossierStatut?: string,
): NextAction {
  if (dossierStatut === "termine" || dossierStatut === "valide") {
    return { kind: "aucune", label: "Dossier terminé", tone: "success" };
  }

  const requis = requiredDocsFor(categorie);
  const manquants = requis.filter((r) => !(documents ?? []).some((d) => docMatches(d, r)));

  if (manquants.length > 0) {
    const first = manquants[0];
    return {
      kind: "manquant",
      label: `Envoyez votre ${first.label}`,
      detail:
        manquants.length > 1
          ? `Il vous reste ${manquants.length} document${manquants.length > 1 ? "s" : ""} à envoyer.`
          : "C'est le dernier document à envoyer.",
      tone: "warning",
      primaryKey: first.key,
      primaryLabel: first.label,
    };
  }

  const tacheClient = (taches ?? []).find(
    (t) => t.cote_client && !t.verrouillee && ["a_faire", "en_cours", "en_attente_client"].includes(t.statut),
  );
  if (tacheClient) {
    return { kind: "tache", label: `À compléter : ${tacheClient.titre}`, tone: "info" };
  }

  return {
    kind: "attente_agence",
    label: "Aucune action requise",
    detail: "L'agence traite votre dossier, vous serez notifié.",
    tone: "muted",
  };
}

export { computeAvancement } from "@/lib/dossier-progress";

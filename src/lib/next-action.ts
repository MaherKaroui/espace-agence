// Calcul de la « prochaine action » côté client pour un dossier.
// Ordre de priorité : documents refusés > à corriger > manquants > tâches client > rien.

import { requiredDocsFor, docMatches } from "@/lib/labels";

export type DocLite = {
  id: string;
  nom: string;
  detected_type?: string | null;
  statut?: string | null;
  commentaire?: string | null;
};

export type TacheLite = {
  id: string;
  titre: string;
  statut: string;
  cote_client?: boolean | null;
  verrouillee?: boolean | null;
};

export type NextAction = {
  kind: "refuse" | "a_corriger" | "manquant" | "tache" | "attente_agence" | "aucune";
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
  // Un document ne remplit son emplacement que s'il est ACCEPTÉ par l'agence.
  // Tant qu'il est en attente / à corriger / refusé, la case reste « à faire ».
  const items = requis.map((r) => ({
    req: r,
    doc: documents.find((d) => docMatches(d, r)) ?? null,
  }));

  const refuse = items.find((i) => i.doc && i.doc.statut === "refuse");
  if (refuse) return {
    kind: "refuse",
    label: `Renvoyez votre ${refuse.req.label}`,
    detail: refuse.doc?.commentaire ?? "Ce document a été refusé par l'agence.",
    tone: "destructive",
    primaryKey: refuse.req.key,
    primaryLabel: refuse.req.label,
  };

  const aCorriger = items.find((i) => i.doc && i.doc.statut === "a_corriger");
  if (aCorriger) return {
    kind: "a_corriger",
    label: `Corrigez votre ${aCorriger.req.label}`,
    detail: aCorriger.doc?.commentaire ?? "L'agence demande une correction.",
    tone: "warning",
    primaryKey: aCorriger.req.key,
    primaryLabel: aCorriger.req.label,
  };

  // Documents validés par l'agence : ils comblent n'importe quel emplacement requis.
  const acceptedItems = items.filter((i) => i.doc && i.doc.statut === "accepte");
  const matchedAcceptedIds = new Set(acceptedItems.map((i) => i.doc!.id));
  const extraValides = documents.filter(
    (d) => !matchedAcceptedIds.has(d.id) && d.statut === "accepte",
  ).length;
  // Un emplacement est « manquant » si aucun doc accepté ne le remplit.
  const manquants = items.filter((i) => !i.doc || i.doc.statut !== "accepte");
  const manquantsCount = Math.max(0, manquants.length - extraValides);

  if (manquantsCount > 0) {
    const first = manquants[0];
    const enAttente = first.doc && first.doc.statut === "en_attente";
    return {
      kind: "manquant",
      label: enAttente
        ? `En attente de validation : ${first.req.label}`
        : `Commencez par envoyer votre ${first.req.label}`,
      detail: enAttente
        ? "L'agence doit encore valider ce document."
        : manquantsCount > 1
          ? `Il vous reste ${manquantsCount} document${manquantsCount > 1 ? "s" : ""} à faire valider.`
          : "C'est le dernier document à faire valider.",
      tone: "warning",
      primaryKey: first.req.key,
      primaryLabel: first.req.label,
    };
  }

  const tacheClient = taches.find(
    (t) => t.cote_client && !t.verrouillee && ["a_faire", "en_cours", "en_attente_client"].includes(t.statut),
  );
  if (tacheClient) return {
    kind: "tache",
    label: `À compléter : ${tacheClient.titre}`,
    tone: "info",
  };

  return {
    kind: "attente_agence",
    label: "Aucune action requise",
    detail: "L'agence traite votre dossier, vous serez notifié.",
    tone: "muted",
  };
}

/**
 * Calcule l'avancement (0-100) d'un dossier côté client à partir des
 * documents requis acceptés et des tâches terminées. Formule :
 * - Dossier terminé/validé → 100
 * - Sinon : moyenne pondérée
 *     • 60% documents requis acceptés / total
 *     • 40% tâches terminées / total
 *   (l'une des composantes est ignorée si son total = 0)
 * - Le résultat est plafonné à 95 tant que le dossier n'est pas terminé,
 *   pour signifier qu'il reste au moins la validation finale de l'agence.
 */
export function computeAvancement(
  categorie: string,
  documents: DocLite[],
  taches: TacheLite[],
  dossierStatut?: string,
): number {
  if (dossierStatut === "termine" || dossierStatut === "valide") return 100;

  const requis = requiredDocsFor(categorie);
  const docsTotal = requis.length;
  const docsOk = requis.filter((r) =>
    documents.some((d) => docMatches(d, r) && d.statut === "accepte"),
  ).length;

  const tachesActives = taches.filter((t) => t.statut !== "annule");
  const tachesTotal = tachesActives.length;
  const tachesOk = tachesActives.filter((t) => t.statut === "termine").length;

  const docsRatio = docsTotal > 0 ? docsOk / docsTotal : null;
  const tachesRatio = tachesTotal > 0 ? tachesOk / tachesTotal : null;

  let ratio: number;
  if (docsRatio !== null && tachesRatio !== null) {
    ratio = docsRatio * 0.6 + tachesRatio * 0.4;
  } else if (docsRatio !== null) {
    ratio = docsRatio;
  } else if (tachesRatio !== null) {
    ratio = tachesRatio;
  } else {
    ratio = 0;
  }

  const pct = Math.round(ratio * 100);
  return Math.min(95, Math.max(0, pct));
}

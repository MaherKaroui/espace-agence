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
  const items = requis.map((r) => ({ req: r, doc: documents.find((d) => docMatches(d, r)) ?? null }));

  const refuse = items.find((i) => i.doc && i.doc.statut === "refuse");
  if (refuse) return {
    kind: "refuse",
    label: `Redéposer : ${refuse.req.label}`,
    detail: refuse.doc?.commentaire ?? "Ce document a été refusé par l'agence.",
    tone: "destructive",
  };

  const aCorriger = items.find((i) => i.doc && i.doc.statut === "a_corriger");
  if (aCorriger) return {
    kind: "a_corriger",
    label: `Corriger : ${aCorriger.req.label}`,
    detail: aCorriger.doc?.commentaire ?? "L'agence demande une correction.",
    tone: "warning",
  };

  const manquants = items.filter((i) => !i.doc);
  if (manquants.length > 0) return {
    kind: "manquant",
    label: manquants.length === 1
      ? `Déposer : ${manquants[0].req.label}`
      : `Déposer ${manquants.length} documents`,
    detail: manquants.length > 1 ? manquants.slice(0, 3).map((m) => m.req.label).join(" · ") : undefined,
    tone: "warning",
  };

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

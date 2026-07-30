// Source unique de vérité pour l'état réel d'un dossier :
// avancement global calculé, anomalies, couleur, prochaine action.

import { requiredDocsFor, docMatches } from "@/lib/labels";

export type HealthDoc = {
  id: string;
  nom: string;
  detected_type?: string | null;
  statut?: string | null;
};

export type HealthTache = {
  id: string;
  statut: string;
  cote_client?: boolean | null;
};

export type HealthLinkedTask = {
  id: string;
  title?: string | null;
  status: string;
  priority?: string | null;
  due_date?: string | null;
  auto?: boolean | null;
} | null;

export type HealthDossier = {
  id: string;
  categorie: string;
  statut: string;
  avancement?: number | null;
  updated_at?: string | null;
  archived_at?: string | null;
};

export type DocsStats = {
  total: number;
  validated: number;
  toReview: number;
  toFix: number;
  missing: number;
  needsAction: boolean;
};

export type StepsStats = { total: number; done: number };

export type AnomalyKey =
  | "zero_but_validated"
  | "full_but_missing"
  | "done_incomplete"
  | "docs_ok_but_in_progress"
  | "steps_done_low_progress"
  | "task_overdue_but_handled"
  | "manual_mismatch";

export type Anomaly = {
  key: AnomalyKey;
  label: string;
  detail: string;
  severity: "critical" | "warning";
};

export type HealthTone =
  | "red" | "orange" | "yellow" | "blue" | "green" | "purple" | "gray";

export type DossierHealth = {
  docs: DocsStats;
  steps: StepsStats;
  /** Avancement calculé (documents + étapes + statut + absence d'alertes). */
  global: number;
  /** Avancement saisi manuellement par l'agence. */
  manual: number;
  /** Avancement basé uniquement sur les documents requis validés. */
  docsProgress: number;
  breakdown: {
    docs: number;      // /50
    steps: number;     // /30
    statut: number;    // /10
    alertes: number;   // /10
  };
  anomalies: Anomaly[];
  score: "bon" | "moyen" | "critique";
  tone: HealthTone;
  toneLabel: string;
  blocked: boolean;
  inactiveDays: number | null;
  taskOverdue: boolean;
  nextAction: string;
  isDone: boolean;
  isArchived: boolean;
};

export const DONE_STATUTS = ["termine", "valide"];

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

export function computeDocsStats(categorie: string, docs: HealthDoc[]): DocsStats {
  const requis = requiredDocsFor(categorie);
  if (requis.length === 0) {
    return { total: 0, validated: 0, toReview: 0, toFix: 0, missing: 0, needsAction: false };
  }
  let validated = 0, toReview = 0, toFix = 0, missing = 0;
  for (const r of requis) {
    const found = docs.find((d) => docMatches(d, r));
    if (!found) { missing++; continue; }
    const s = found.statut ?? "en_attente";
    if (s === "accepte") validated++;
    else if (s === "a_corriger" || s === "refuse") toFix++;
    else toReview++;
  }
  return {
    total: requis.length,
    validated, toReview, toFix, missing,
    needsAction: toReview + toFix + missing > 0,
  };
}

const TONE_LABELS: Record<HealthTone, string> = {
  red: "Critique",
  orange: "Documents à vérifier",
  yellow: "Documents manquants",
  blue: "En cours",
  green: "Complet / prêt",
  purple: "Avancement incohérent",
  gray: "En attente / archivé",
};

/** Classes Tailwind pour la bande latérale et le fond de carte. */
export const TONE_STYLES: Record<HealthTone, { bar: string; card: string; badge: string }> = {
  red:    { bar: "bg-destructive",      card: "bg-destructive/5 border-destructive/30", badge: "bg-destructive/15 text-destructive border-destructive/30" },
  orange: { bar: "bg-orange-500",       card: "bg-orange-500/5 border-orange-500/30",   badge: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30" },
  yellow: { bar: "bg-warning",          card: "bg-warning/5 border-warning/30",         badge: "bg-warning/15 text-warning-foreground border-warning/30" },
  blue:   { bar: "bg-blue-500",         card: "bg-blue-500/5 border-blue-500/25",       badge: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30" },
  green:  { bar: "bg-success",          card: "bg-success/5 border-success/25",         badge: "bg-success/15 text-success border-success/25" },
  purple: { bar: "bg-purple-500",       card: "bg-purple-500/5 border-purple-500/30",   badge: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30" },
  gray:   { bar: "bg-muted-foreground/40", card: "bg-muted/40 border-border",           badge: "bg-muted text-muted-foreground border-border" },
};

export function computeDossierHealth(args: {
  dossier: HealthDossier;
  documents: HealthDoc[];
  taches: HealthTache[];
  linkedTask?: HealthLinkedTask;
}): DossierHealth {
  const { dossier, documents, taches, linkedTask = null } = args;
  const docs = computeDocsStats(dossier.categorie, documents);

  const activeTaches = taches.filter((t) => t.statut !== "annule");
  const steps: StepsStats = {
    total: activeTaches.length,
    done: activeTaches.filter((t) => t.statut === "termine").length,
  };

  const isDone = DONE_STATUTS.includes(dossier.statut);
  const isArchived = !!dossier.archived_at;
  const manual = Math.max(0, Math.min(100, dossier.avancement ?? 0));

  const docsRatio = docs.total > 0 ? docs.validated / docs.total : (isDone ? 1 : 0);
  const stepsRatio = steps.total > 0 ? steps.done / steps.total : (isDone ? 1 : 0);
  const docsProgress = Math.round(docsRatio * 100);

  const inactiveDays = daysSince(dossier.updated_at);
  const inactive = inactiveDays !== null && inactiveDays >= 7 && !isDone && dossier.statut !== "refuse";

  const taskOverdue = !!(
    linkedTask &&
    linkedTask.status !== "terminee" &&
    linkedTask.due_date &&
    new Date(linkedTask.due_date) < new Date()
  );

  // --- Anomalies -----------------------------------------------------------
  const anomalies: Anomaly[] = [];
  if (manual === 0 && docs.validated > 0) {
    anomalies.push({
      key: "zero_but_validated",
      label: "0 % mais documents validés",
      detail: `${docs.validated} document(s) validé(s) alors que l'avancement manuel est à 0 %.`,
      severity: "warning",
    });
  }
  if (manual >= 100 && (docs.missing > 0 || docs.toFix > 0)) {
    anomalies.push({
      key: "full_but_missing",
      label: "100 % mais documents manquants",
      detail: `${docs.missing + docs.toFix} pièce(s) encore non validée(s).`,
      severity: "warning",
    });
  }
  if (isDone && docs.needsAction) {
    anomalies.push({
      key: "done_incomplete",
      label: "Terminé avec pièces non validées",
      detail: `Le dossier est marqué ${dossier.statut} mais ${docs.missing + docs.toFix + docs.toReview} pièce(s) restent à traiter.`,
      severity: "critical",
    });
  }
  if (!isDone && docs.total > 0 && docs.validated === docs.total) {
    anomalies.push({
      key: "docs_ok_but_in_progress",
      label: "Tous les documents validés, dossier encore en cours",
      detail: "Le dossier peut probablement être finalisé.",
      severity: "warning",
    });
  }
  if (!isDone && steps.total > 0 && steps.done === steps.total && manual < 80) {
    anomalies.push({
      key: "steps_done_low_progress",
      label: "Étapes terminées mais avancement faible",
      detail: `Toutes les étapes sont terminées alors que l'avancement manuel est à ${manual} %.`,
      severity: "warning",
    });
  }
  if (taskOverdue && (isDone || docsRatio === 1)) {
    anomalies.push({
      key: "task_overdue_but_handled",
      label: "Tâche auto en retard alors que le dossier est traité",
      detail: "Clôturez la tâche automatique liée.",
      severity: "warning",
    });
  }

  // --- Score global --------------------------------------------------------
  const blockingAnomalies = anomalies.filter((a) => a.severity === "critical").length > 0 || inactive;
  const bDocs = Math.round(docsRatio * 50);
  const bSteps = Math.round(stepsRatio * 30);
  const bStatut = isDone ? 10 : ["en_cours_etude", "en_cours_traitement"].includes(dossier.statut) ? 5 : 0;
  const bAlertes = blockingAnomalies || docs.toFix > 0 ? 0 : 10;
  let global = bDocs + bSteps + bStatut + bAlertes;
  if (isDone && !docs.needsAction) global = 100;
  global = Math.max(0, Math.min(100, global));

  // Écart significatif entre saisie manuelle et calcul réel
  if (Math.abs(manual - global) >= 20) {
    anomalies.push({
      key: "manual_mismatch",
      label: "Avancement incohérent",
      detail: manual < global
        ? `Le dossier semble plus avancé (${global} %) que le pourcentage manuel (${manual} %).`
        : `Le pourcentage manuel (${manual} %) est supérieur à l'avancement réel calculé (${global} %).`,
      severity: "warning",
    });
  }

  // --- Couleur -------------------------------------------------------------
  const hasProgressAnomaly = anomalies.some((a) =>
    ["manual_mismatch", "zero_but_validated", "full_but_missing", "steps_done_low_progress"].includes(a.key));
  const critical = anomalies.some((a) => a.severity === "critical") || inactive ||
    (taskOverdue && linkedTask?.priority === "urgente");

  let tone: HealthTone;
  if (isArchived) tone = "gray";
  else if (critical) tone = "red";
  else if (hasProgressAnomaly) tone = "purple";
  else if (isDone || (docs.total > 0 && docs.validated === docs.total)) tone = "green";
  else if (docs.toReview > 0 || docs.toFix > 0) tone = "orange";
  else if (docs.missing > 0) tone = "yellow";
  else if (["en_attente", "a_completer"].includes(dossier.statut)) tone = "gray";
  else tone = "blue";

  const score: DossierHealth["score"] =
    critical ? "critique" : anomalies.length > 0 || docs.needsAction ? "moyen" : "bon";

  // --- Prochaine action ----------------------------------------------------
  let nextAction: string;
  if (isArchived) nextAction = "Dossier archivé — aucune action";
  else if (docs.toFix > 0) nextAction = `Relancer le client pour ${docs.toFix} document(s) à corriger`;
  else if (docs.toReview > 0) nextAction = `Vérifier ${docs.toReview} document(s) reçu(s)`;
  else if (docs.missing > 0) nextAction = `Relancer le client pour ${docs.missing} document(s) manquant(s)`;
  else if (steps.total > 0 && steps.done < steps.total) nextAction = `Finaliser l'étape ${steps.done + 1}/${steps.total}`;
  else if (!isDone && docsRatio === 1) nextAction = "Tout est validé : clôturer le dossier";
  else if (taskOverdue) nextAction = "Clôturer la tâche automatique liée";
  else if (Math.abs(manual - global) >= 20) nextAction = "Mettre à jour l'avancement manuel";
  else if (isDone) nextAction = "Aucune action — dossier terminé";
  else nextAction = "Suivre l'avancement, rien de bloquant";

  return {
    docs, steps, global, manual, docsProgress,
    breakdown: { docs: bDocs, steps: bSteps, statut: bStatut, alertes: bAlertes },
    anomalies,
    score,
    tone,
    toneLabel: TONE_LABELS[tone],
    blocked: inactive,
    inactiveDays,
    taskOverdue,
    nextAction,
    isDone,
    isArchived,
  };
}

// --- Filtres rapides -------------------------------------------------------

export type QuickFilter =
  | "all" | "to_review_all" | "missing" | "to_review" | "inconsistent"
  | "ready" | "blocked" | "no_task" | "task_overdue"
  | "p0" | "p1_33" | "p34_66" | "p67_99" | "p100";

export const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "to_review_all", label: "À revoir" },
  { key: "missing", label: "Documents manquants" },
  { key: "to_review", label: "Documents à vérifier" },
  { key: "inconsistent", label: "Avancement incohérent" },
  { key: "ready", label: "Prêts à finaliser" },
  { key: "blocked", label: "Bloqués" },
  { key: "no_task", label: "Sans tâche liée" },
  { key: "task_overdue", label: "Tâches en retard" },
  { key: "p0", label: "0 %" },
  { key: "p1_33", label: "1–33 %" },
  { key: "p34_66", label: "34–66 %" },
  { key: "p67_99", label: "67–99 %" },
  { key: "p100", label: "100 %" },
];

export function matchesQuickFilter(
  f: QuickFilter,
  h: DossierHealth,
  hasLinkedTask: boolean,
): boolean {
  switch (f) {
    case "all": return true;
    case "to_review_all": return h.docs.needsAction || h.anomalies.length > 0;
    case "missing": return h.docs.missing > 0;
    case "to_review": return h.docs.toReview > 0;
    case "inconsistent": return h.anomalies.some((a) =>
      ["manual_mismatch", "zero_but_validated", "full_but_missing", "steps_done_low_progress"].includes(a.key));
    case "ready": return !h.isDone && h.docs.total > 0 && h.docs.validated === h.docs.total;
    case "blocked": return h.blocked;
    case "no_task": return !hasLinkedTask;
    case "task_overdue": return h.taskOverdue;
    case "p0": return h.global === 0;
    case "p1_33": return h.global >= 1 && h.global <= 33;
    case "p34_66": return h.global >= 34 && h.global <= 66;
    case "p67_99": return h.global >= 67 && h.global <= 99;
    case "p100": return h.global === 100;
    default: return true;
  }
}

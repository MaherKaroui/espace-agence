// Pôle Certification & EDOF — types, statuts, code couleurs et calculs partagés
// par la fiche, le tableau de bord, le tableau, le kanban, le calendrier et les rappels.
// Les tables pc_* ne sont pas encore dans types.ts (généré) : accès via `as any`
// comme les autres modules récents, typage local ci-dessous.
import {
  Circle, Loader, Hourglass, CheckCircle2, XCircle, Scale, RotateCcw, AlertTriangle, Clock,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const PC_BUCKET = "pole-certification";

export type PcType = "certificateur" | "edof";
export type PcStatut = "a_faire" | "en_cours" | "en_attente" | "valide" | "refuse" | "recours" | "a_recommencer";
/** Statut affiché : statut d'étape, ou état calculé (retard, terminé, archivé, pièce qui expire). */
export type PcTone = PcStatut | "retard" | "bientot" | "termine" | "archive";

export interface PcDossier {
  id: string;
  type: PcType;
  titre: string;
  organisme: string | null;
  certificateur: string | null;
  code_rs: string | null;
  responsable_id: string;
  date_cible: string | null;
  notes: string | null;
  parent_id: string | null;
  archived_at: string | null;
  archived_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PcEtape {
  id: string;
  dossier_id: string;
  groupe: string;
  ordre: number;
  intitule: string;
  tentative: number;
  remplacee: boolean;
  statut: PcStatut;
  date_debut: string | null;
  date_echeance: string | null;
  date_realisation: string | null;
  responsable_id: string | null;
  notes: string | null;
  motif_refus: string | null;
  date_limite_recours: string | null;
  a_saisir: string | null;
  relance_jours: number | null;
  en_cours_max_jours: number | null;
  event_kind: "visio" | "webinaire" | null;
  event_at: string | null;
  lien_expiration: boolean;
  lien_expire_at: string | null;
  bloque_si_piece_perimee: boolean;
  collecte_pieces: boolean;
  checklist: Record<string, boolean>;
  email_actif: boolean;
  rappel_reporte_jusqua: string | null;
  envoye_at: string | null;
  statut_change_at: string;
  force_motif: string | null;
  force_par: string | null;
  created_at: string;
  updated_at: string;
}

export interface PcDocument {
  id: string;
  dossier_id: string;
  piece_type_id: string | null;
  nom: string;
  date_emission: string | null;
  validite_jours: number | null;
  date_peremption: string | null;
  etapes: string[];
  version: number;
  current_fichier_id: string | null;
  rappel_reporte_jusqua: string | null;
  created_at: string;
  updated_at: string;
}

export interface PcFichier {
  id: string;
  dossier_id: string;
  etape_id: string | null;
  document_id: string | null;
  version: number | null;
  date_emission: string | null;
  storage_path: string;
  filename: string;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface PcEvenement {
  id: string;
  dossier_id: string;
  etape_id: string | null;
  actor_id: string | null;
  action: string;
  details: Record<string, any>;
  created_at: string;
}

export interface PcMembre {
  dossier_id: string;
  user_id: string;
  role: "collaborateur" | "lecture";
}

export interface PcPieceType {
  id: string;
  code: string;
  libelle: string;
  aide: string | null;
  validite_jours: number | null;
  dossier_types: PcType[];
  obligatoire: boolean;
  ordre: number;
  actif: boolean;
}

export interface PcEtapeModele {
  id: string;
  dossier_type: PcType;
  ordre: number;
  intitule: string;
  a_saisir: string | null;
  relance_jours: number | null;
  en_cours_max_jours: number | null;
  event_kind: "visio" | "webinaire" | null;
  lien_expiration: boolean;
  bloque_si_piece_perimee: boolean;
  collecte_pieces: boolean;
  checklist: string[];
  email_actif: boolean;
  actif: boolean;
}

export interface PcProfile {
  id: string;
  prenom: string;
  nom: string;
  email: string;
}

export const PC_TYPES: { value: PcType; label: string }[] = [
  { value: "certificateur", label: "Certificateur (titre RS)" },
  { value: "edof", label: "EDOF (Caisse des Dépôts)" },
];
export const pcTypeLabel = (t: PcType) => (t === "edof" ? "EDOF" : "Certificateur");

export const PC_STATUTS: { value: PcStatut; label: string }[] = [
  { value: "a_faire", label: "À faire" },
  { value: "en_cours", label: "En cours" },
  { value: "en_attente", label: "En attente de réponse" },
  { value: "valide", label: "Validé" },
  { value: "refuse", label: "Refusé" },
  { value: "recours", label: "Recours" },
  { value: "a_recommencer", label: "À recommencer" },
];

// Code couleurs unique (cahier des charges §9) : toujours libellé + icône, lisible en sombre.
export const PC_TONES: Record<PcTone, { label: string; icon: LucideIcon; badge: string; dot: string; cell: string; hex: string }> = {
  a_faire:       { label: "À faire",            icon: Circle,        hex: "#64748b", dot: "bg-slate-400",   badge: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",   cell: "bg-slate-500/10" },
  en_cours:      { label: "En cours",           icon: Loader,        hex: "#2563eb", dot: "bg-blue-500",    badge: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",       cell: "bg-blue-500/10" },
  en_attente:    { label: "En attente de réponse", icon: Hourglass,  hex: "#ca8a04", dot: "bg-yellow-400",  badge: "bg-yellow-400/20 text-yellow-800 dark:text-yellow-200 border-yellow-500/40", cell: "bg-yellow-400/15" },
  valide:        { label: "Validé",             icon: CheckCircle2,  hex: "#16a34a", dot: "bg-green-500",   badge: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30",   cell: "bg-green-500/10" },
  refuse:        { label: "Refusé",             icon: XCircle,       hex: "#dc2626", dot: "bg-red-500",     badge: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",           cell: "bg-red-500/10" },
  retard:        { label: "Échéance dépassée",  icon: AlertTriangle, hex: "#dc2626", dot: "bg-red-500",     badge: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",           cell: "bg-red-500/10" },
  recours:       { label: "Recours",            icon: Scale,         hex: "#9333ea", dot: "bg-purple-500",  badge: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30", cell: "bg-purple-500/10" },
  a_recommencer: { label: "À recommencer",      icon: RotateCcw,     hex: "#ea580c", dot: "bg-orange-500",  badge: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30", cell: "bg-orange-500/10" },
  bientot:       { label: "Expire bientôt",     icon: Clock,         hex: "#ea580c", dot: "bg-orange-500",  badge: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30", cell: "bg-orange-500/10" },
  termine:       { label: "Terminé",            icon: CheckCircle2,  hex: "#16a34a", dot: "bg-green-500",   badge: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30",   cell: "bg-green-500/10" },
  archive:       { label: "Archivé",            icon: Circle,        hex: "#64748b", dot: "bg-slate-400",   badge: "bg-muted text-muted-foreground border-border",                              cell: "" },
};

// ---------- Dates ----------
export const todayIso = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
export function addDaysIso(iso: string, days: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(fromIso: string, toIso: string) {
  return Math.round((Date.parse(toIso + "T12:00:00Z") - Date.parse(fromIso + "T12:00:00Z")) / 86_400_000);
}
export function frDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(iso + "T12:00:00Z") : new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris" });
}
export function frDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
}

// ---------- Pièces : validité ----------
export const PC_ALERTE_BIENTOT_JOURS = 15;
export type PcDocState = "valide" | "bientot" | "perime" | "sans_date" | "sans_peremption";
export function docState(doc: Pick<PcDocument, "date_emission" | "date_peremption">, today = todayIso()): { state: PcDocState; joursRestants: number | null } {
  if (!doc.date_emission) return { state: "sans_date", joursRestants: null };
  if (!doc.date_peremption) return { state: "sans_peremption", joursRestants: null };
  const j = daysBetween(today, doc.date_peremption);
  if (j < 0) return { state: "perime", joursRestants: j };
  if (j < PC_ALERTE_BIENTOT_JOURS) return { state: "bientot", joursRestants: j };
  return { state: "valide", joursRestants: j };
}
/** La pièce aura-t-elle dépassé sa validité à la date d'envoi prévue ? */
export function perimeeAu(doc: Pick<PcDocument, "date_peremption">, dateIso: string | null) {
  return !!(doc.date_peremption && dateIso && doc.date_peremption < dateIso);
}
export const DOC_STATE_UI: Record<PcDocState, { label: string; tone: PcTone }> = {
  valide: { label: "Valide", tone: "valide" },
  bientot: { label: "Expire bientôt", tone: "bientot" },
  perime: { label: "Périmé", tone: "refuse" },
  sans_date: { label: "Date d'émission manquante", tone: "a_faire" },
  sans_peremption: { label: "Sans péremption", tone: "valide" },
};

// ---------- Étapes et état du dossier ----------
/** Tentatives en vigueur, dans l'ordre du parcours. */
export function currentEtapes(etapes: PcEtape[]) {
  return etapes.filter((e) => !e.remplacee).sort((a, b) => a.ordre - b.ordre || b.tentative - a.tentative);
}
export function etapeEnRetard(e: PcEtape, today = todayIso()) {
  return !!e.date_echeance && e.date_echeance < today && e.statut !== "valide" && !e.remplacee;
}
export function etapeTone(e: PcEtape, today = todayIso()): PcTone {
  return etapeEnRetard(e, today) ? "retard" : e.statut;
}

export interface PcDossierState {
  etapeCourante: PcEtape | null;
  index: number;          // position de l'étape courante (colonne kanban) ; = nb d'étapes si terminé
  statut: PcStatut | "termine";
  tone: PcTone;
  enRetard: boolean;
  prochaineEcheance: string | null;
  tentatives: number;     // nombre max de tentatives sur l'étape courante
  totalTentatives: number;
  docsPerimes: boolean;
  docsBientot: boolean;
}

export function dossierState(d: PcDossier, etapes: PcEtape[], docs: PcDocument[], today = todayIso()): PcDossierState {
  const cur = currentEtapes(etapes.filter((e) => e.dossier_id === d.id));
  const index = cur.findIndex((e) => e.statut !== "valide");
  const etapeCourante = index >= 0 ? cur[index] : null;
  const enRetard = cur.some((e) => etapeEnRetard(e, today));
  const echeances = cur.filter((e) => e.statut !== "valide").flatMap((e) => [e.date_echeance, e.event_at?.slice(0, 10)]).filter(Boolean) as string[];
  const myDocs = docs.filter((x) => x.dossier_id === d.id).map((x) => docState(x, today).state);
  const all = etapes.filter((e) => e.dossier_id === d.id);
  const statut = etapeCourante ? etapeCourante.statut : "termine";
  const tone: PcTone = d.archived_at ? "archive" : enRetard ? "retard" : statut;
  return {
    etapeCourante,
    index: index >= 0 ? index : cur.length,
    statut,
    tone,
    enRetard,
    prochaineEcheance: echeances.sort()[0] ?? null,
    tentatives: etapeCourante ? all.filter((e) => e.groupe === etapeCourante.groupe).length : 1,
    totalTentatives: all.length - cur.length,
    docsPerimes: myDocs.includes("perime"),
    docsBientot: myDocs.includes("bientot"),
  };
}

// ---------- Personnes ----------
export function personName(p: PcProfile | undefined | null) {
  if (!p) return "—";
  const n = `${p.prenom ?? ""} ${p.nom ?? ""}`.trim();
  return n || p.email;
}

// ---------- Données ----------
const db = supabase as any;

export async function fetchPcAll() {
  const [dossiers, etapes, documents, membres] = await Promise.all([
    db.from("pc_dossiers").select("*").order("created_at", { ascending: false }),
    db.from("pc_etapes").select("*"),
    db.from("pc_documents").select("*"),
    db.from("pc_membres").select("*"),
  ]);
  for (const r of [dossiers, etapes, documents, membres]) if (r.error) throw r.error;
  return {
    dossiers: (dossiers.data ?? []) as PcDossier[],
    etapes: (etapes.data ?? []) as PcEtape[],
    documents: (documents.data ?? []) as PcDocument[],
    membres: (membres.data ?? []) as PcMembre[],
  };
}

/** Membres de l'équipe (staff) pour les listes de responsables. */
export async function fetchPcStaff(): Promise<PcProfile[]> {
  const { data: roles, error } = await supabase.from("user_roles").select("user_id, role").in("role", ["admin", "direction", "manager", "consultant"]);
  if (error) throw error;
  const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
  if (ids.length === 0) return [];
  const { data, error: e2 } = await supabase.from("profiles").select("id, prenom, nom, email").in("id", ids).is("archived_at", null);
  if (e2) throw e2;
  return ((data ?? []) as PcProfile[]).sort((a, b) => personName(a).localeCompare(personName(b), "fr"));
}

export async function fetchPcProfiles(ids: string[]): Promise<PcProfile[]> {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (uniq.length === 0) return [];
  const { data, error } = await supabase.from("profiles").select("id, prenom, nom, email").in("id", uniq);
  if (error) throw error;
  return (data ?? []) as PcProfile[];
}

export async function uploadPcFile(dossierId: string, file: File) {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${dossierId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(PC_BUCKET).upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  return path;
}

export async function openPcFile(f: Pick<PcFichier, "storage_path" | "filename">) {
  const { data, error } = await supabase.storage.from(PC_BUCKET).createSignedUrl(f.storage_path, 60, { download: f.filename });
  if (error || !data?.signedUrl) throw error ?? new Error("Lien indisponible");
  window.open(data.signedUrl, "_blank", "noopener");
}

/** Formats acceptés par la CDC pour les pièces EDOF. */
export const PC_ACCEPT_PIECES = ".pdf,.png,.jpg,.jpeg,.gif,.bmp";

/** Modèle de mail de relance prérempli (certificateur ou CDC). */
export function relanceMailto(d: PcDossier, e: PcEtape, to = "") {
  const dest = d.type === "edof" ? "la Caisse des Dépôts" : d.certificateur || "le certificateur";
  const subject = `Relance — ${d.titre} — ${e.intitule}`;
  const body =
    `Bonjour,\n\nNous revenons vers vous concernant « ${e.intitule} » pour ${d.organisme || d.titre}` +
    (e.envoye_at ? `, transmis le ${frDate(e.envoye_at)}` : "") +
    `.\nPourriez-vous nous indiquer où en est le traitement par ${dest} ?\n\nEn vous remerciant par avance,\nCordialement`;
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Libellés de l'historique. */
export const PC_ACTIONS: Record<string, string> = {
  "dossier.cree": "Dossier créé",
  "dossier.modifie": "Dossier modifié",
  "dossier.responsable": "Changement de responsable",
  "dossier.archive": "Dossier archivé",
  "dossier.desarchive": "Dossier désarchivé",
  "etape.ajoutee": "Étape ajoutée",
  "etape.modifiee": "Étape modifiée",
  "etape.statut": "Changement de statut",
  "etape.supprimee": "Étape supprimée",
  "etape.forcage": "Forçage administrateur",
  "etape.fichier": "Pièce jointe ajoutée",
  "piece.ajoutee": "Pièce ajoutée",
  "piece.modifiee": "Pièce modifiée",
  "piece.version": "Nouvelle version de pièce",
  "piece.supprimee": "Pièce supprimée",
  "membre.ajoute": "Personne affectée",
  "membre.retire": "Personne retirée",
  "rappel.reporte": "Rappel reporté",
  "relance.envoyee": "Relance préparée",
};

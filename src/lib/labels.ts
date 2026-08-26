export const CATEGORIES = [
  { value: "qualiopi", label: "Certification Qualiopi" },
  { value: "bpf", label: "BPF annuel" },
  { value: "nda", label: "Demande de NDA" },
  { value: "cfa", label: "Création ou gestion CFA" },
  { value: "vae", label: "VAE" },
  { value: "edof", label: "Dossier EDOF / CPF" },
  { value: "rncp_rs", label: "Certification RNCP / RS" },
  { value: "juridique", label: "Juridique" },
  { value: "contrats", label: "Contrats" },
  { value: "documents_administratifs", label: "Documents administratifs" },
  { value: "autres", label: "Je ne sais pas / Autre demande" },
] as const;

// Sous-types Juridique — libellés canoniques (aussi validés côté trigger DB).
export const JURIDIQUE_TYPES = [
  { value: "Création d'entreprise", label: "Création d'entreprise" },
  { value: "Transfert de siège social", label: "Transfert de siège social" },
  { value: "Modification d'objet social", label: "Modification d'objet social" },
  { value: "Cession de parts", label: "Cession de parts" },
] as const;

export type JuridiqueType = (typeof JURIDIQUE_TYPES)[number]["value"];


export type Categorie = (typeof CATEGORIES)[number]["value"];

export const STATUTS = [
  { value: "en_attente", label: "En attente", tone: "muted" },
  { value: "documents_manquants", label: "Documents manquants", tone: "warning" },
  { value: "en_cours_etude", label: "En cours d'étude", tone: "info" },
  { value: "en_cours_traitement", label: "En cours de traitement", tone: "info" },
  { value: "planification", label: "Planification", tone: "info" },
  { value: "audit_realise", label: "Audit réalisé", tone: "success" },
  { value: "a_completer", label: "À compléter", tone: "warning" },
  { value: "valide", label: "Validé", tone: "success" },
  { value: "refuse", label: "Refusé", tone: "destructive" },
  { value: "termine", label: "Dossier clôturé", tone: "success" },
] as const;

/** Statuts considérés comme « demande terminée » (sortie des listes en cours). */
export const STATUTS_CLOS: string[] = ["termine", "annule", "refuse", "audit_realise"];

/** Statuts affichés dans la liste « demandes en cours ». */
export const isEnCours = (statut: string) => !STATUTS_CLOS.includes(statut) && statut !== "planification";


export type Statut = (typeof STATUTS)[number]["value"];

/** Statuts réservés aux dossiers Qualiopi (planification d'audit). */
export const STATUTS_QUALIOPI_ONLY: string[] = ["planification", "audit_realise"];

/** Le statut est-il pertinent pour cette catégorie de dossier ? */
export const statutAppliesTo = (statut: string, categorie?: string | null): boolean =>
  !STATUTS_QUALIOPI_ONLY.includes(statut) || categorie === "qualiopi";

/** Statuts sélectionnables pour une catégorie donnée. */
export const statutsFor = (categorie?: string | null) =>
  STATUTS.filter((s) => statutAppliesTo(s.value, categorie));

export const categorieLabel = (v: string) => CATEGORIES.find((c) => c.value === v)?.label ?? v;
export const statutLabel = (v: string) => STATUTS.find((s) => s.value === v)?.label ?? v;
export const statutTone = (v: string): string => STATUTS.find((s) => s.value === v)?.tone ?? "muted";

// Documents requis par catégorie de dossier.
// `match` : mots-clés (insensibles à la casse) cherchés dans le nom du fichier déposé.
// `hint`  : explication courte, en français simple, destinée aux clients.
export type RequiredDoc = { key: string; label: string; match: string[]; hint?: string };

const HINTS: Record<string, string> = {
  kbis: "Le KBIS est un document officiel qui prouve que votre entreprise existe. Vous pouvez le télécharger sur infogreffe.fr (moins de 3 mois de préférence).",
  b3: "L'extrait B3 est votre casier judiciaire (bulletin n° 3). Vous pouvez le demander gratuitement sur casier-judiciaire.justice.gouv.fr.",
  cni: "Une photo ou un scan de votre carte d'identité, recto ET verso. Un passeport en cours de validité fonctionne aussi.",
  cv: "Votre CV à jour, au format PDF ou Word. Une version récente suffit.",
  diplome: "Vos diplômes (bac, école, formations). Une photo lisible ou un scan PDF suffit.",
  nda: "Le numéro de déclaration d'activité (NDA) délivré par la préfecture. C'est le récépissé que vous avez reçu par courrier.",
  bpf: "Le Bilan Pédagogique et Financier — le dernier que vous avez envoyé à la préfecture.",
  programme: "Le contenu détaillé de vos formations (objectifs, durée, public visé).",
  factures: "Quelques factures récentes émises à des clients ou stagiaires.",
  bail: "Votre bail commercial ou attestation d'hébergement pour le local.",
  bilan: "Le dernier bilan comptable de l'entreprise (fourni par votre comptable).",
  compte_resultat: "Le dernier compte de résultat (fourni par votre comptable).",
  conventions: "Vos conventions de formation signées avec vos clients ou stagiaires.",
  reglement: "Le règlement intérieur de votre organisme (règles applicables aux stagiaires).",
  attestations: "Vos attestations d'emploi (fournies par vos employeurs) qui prouvent votre expérience.",
  qualiopi: "Votre certificat Qualiopi en cours de validité.",
  catalogue: "Votre catalogue de formations proposées.",
  rib: "Un RIB de votre entreprise (Relevé d'Identité Bancaire).",
};

const withHint = <T extends { key: string }>(d: T): T & { hint?: string } => ({ ...d, hint: HINTS[d.key] });

export const REQUIRED_DOCUMENTS: Record<string, RequiredDoc[]> = {
  nda: [
    { key: "kbis", label: "KBIS", match: ["kbis"] },
    { key: "b3", label: "Extrait B3 (casier judiciaire)", match: ["b3", "casier"] },
    { key: "cni", label: "Carte d'identité (recto/verso)", match: ["cni", "identite", "identité", "passeport"] },
    { key: "cv", label: "CV du dirigeant", match: ["cv", "curriculum"] },
    { key: "diplome", label: "Diplôme(s)", match: ["diplome", "diplôme", "diploma"] },
  ].map(withHint),
  qualiopi: [
    { key: "kbis", label: "KBIS", match: ["kbis"] },
    { key: "nda", label: "Numéro de déclaration d'activité (NDA)", match: ["nda", "declaration", "déclaration"] },
    { key: "bpf", label: "Dernier BPF", match: ["bpf"] },
    { key: "cv", label: "CV formateurs", match: ["cv", "curriculum"] },
    { key: "programme", label: "Programmes de formation", match: ["programme"] },
    { key: "factures", label: "Factures", match: ["facture"] },
    { key: "bail", label: "Bail commercial", match: ["bail"] },
    { key: "diplome", label: "Diplôme(s) du dirigeant", match: ["diplome", "diplôme", "diploma"] },
  ].map(withHint),
  bpf: [
    { key: "kbis", label: "KBIS", match: ["kbis"] },
    { key: "bilan", label: "Bilan comptable", match: ["bilan"] },
    { key: "compte_resultat", label: "Compte de résultat", match: ["resultat", "résultat"] },
    { key: "conventions", label: "Conventions de formation", match: ["convention"] },
  ].map(withHint),
  cfa: [
    { key: "kbis", label: "KBIS", match: ["kbis"] },
    { key: "nda", label: "NDA", match: ["nda"] },
    { key: "reglement", label: "Règlement intérieur", match: ["reglement", "règlement"] },
    { key: "programme", label: "Programmes pédagogiques", match: ["programme"] },
  ].map(withHint),
  vae: [
    { key: "cni", label: "Carte d'identité (recto/verso)", match: ["cni", "identite", "identité", "passeport"] },
    { key: "cv", label: "CV détaillé", match: ["cv", "curriculum"] },
    { key: "diplome", label: "Diplômes obtenus", match: ["diplome", "diplôme"] },
    { key: "attestations", label: "Attestations de travail", match: ["attestation"] },
  ].map(withHint),
  edof: [
    { key: "kbis", label: "KBIS", match: ["kbis"] },
    { key: "qualiopi", label: "Certificat Qualiopi", match: ["qualiopi"] },
    { key: "catalogue", label: "Catalogue de formations", match: ["catalogue"] },
  ].map(withHint),
  rncp_rs: [
    { key: "kbis", label: "KBIS", match: ["kbis"] },
    { key: "nda", label: "Numéro de déclaration d'activité (NDA)", match: ["nda", "declaration", "déclaration"] },
    { key: "qualiopi", label: "Certificat Qualiopi", match: ["qualiopi"] },
    { key: "programme", label: "Programme de la certification visée", match: ["programme"] },
    { key: "cv", label: "CV des formateurs / concepteurs", match: ["cv", "curriculum"] },
  ].map(withHint),
  contrats: [
    { key: "kbis", label: "KBIS", match: ["kbis"] },
    { key: "cni", label: "Carte d'identité du signataire", match: ["cni", "identite", "identité"] },
    { key: "rib", label: "RIB", match: ["rib"] },
  ].map(withHint),
  documents_administratifs: [],
  autres: [],
};

export const requiredDocsFor = (categorie: string): RequiredDoc[] =>
  REQUIRED_DOCUMENTS[categorie] ?? [];

export const docMatches = (
  doc: { nom: string; detected_type?: string | null },
  req: RequiredDoc,
): boolean => {
  if (doc.detected_type && req.key === doc.detected_type) return true;
  const n = doc.nom.toLowerCase();
  return req.match.some((kw) => n.includes(kw.toLowerCase()));
};


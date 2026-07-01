export const CATEGORIES = [
  { value: "qualiopi", label: "Qualiopi" },
  { value: "bpf", label: "BPF" },
  { value: "nda", label: "NDA" },
  { value: "cfa", label: "CFA" },
  { value: "vae", label: "VAE" },
  { value: "edof", label: "EDOF" },
  { value: "contrats", label: "Contrats" },
  { value: "documents_administratifs", label: "Documents administratifs" },
  { value: "autres", label: "Autres" },
] as const;

export type Categorie = (typeof CATEGORIES)[number]["value"];

export const STATUTS = [
  { value: "en_attente", label: "En attente", tone: "muted" },
  { value: "documents_manquants", label: "Documents manquants", tone: "warning" },
  { value: "en_cours_etude", label: "En cours d'étude", tone: "info" },
  { value: "en_cours_traitement", label: "En cours de traitement", tone: "info" },
  { value: "a_completer", label: "À compléter", tone: "warning" },
  { value: "valide", label: "Validé", tone: "success" },
  { value: "refuse", label: "Refusé", tone: "destructive" },
  { value: "termine", label: "Terminé", tone: "success" },
] as const;

export type Statut = (typeof STATUTS)[number]["value"];

export const categorieLabel = (v: string) => CATEGORIES.find((c) => c.value === v)?.label ?? v;
export const statutLabel = (v: string) => STATUTS.find((s) => s.value === v)?.label ?? v;
export const statutTone = (v: string): string => STATUTS.find((s) => s.value === v)?.tone ?? "muted";

// Documents requis par catégorie de dossier.
// `match` : mots-clés (insensibles à la casse) cherchés dans le nom du fichier déposé.
export type RequiredDoc = { key: string; label: string; match: string[] };

export const REQUIRED_DOCUMENTS: Record<string, RequiredDoc[]> = {
  nda: [
    { key: "kbis", label: "KBIS", match: ["kbis"] },
    { key: "b3", label: "Extrait B3 (casier judiciaire)", match: ["b3", "casier"] },
    { key: "cni", label: "Carte d'identité (recto/verso)", match: ["cni", "identite", "identité", "passeport"] },
    { key: "cv", label: "CV du dirigeant", match: ["cv", "curriculum"] },
    { key: "diplome", label: "Diplôme(s)", match: ["diplome", "diplôme", "diploma"] },
  ],
  qualiopi: [
    { key: "kbis", label: "KBIS", match: ["kbis"] },
    { key: "nda", label: "Numéro de déclaration d'activité (NDA)", match: ["nda", "declaration", "déclaration"] },
    { key: "bpf", label: "Dernier BPF", match: ["bpf"] },
    { key: "cv", label: "CV formateurs", match: ["cv", "curriculum"] },
    { key: "programme", label: "Programmes de formation", match: ["programme"] },
  ],
  bpf: [
    { key: "kbis", label: "KBIS", match: ["kbis"] },
    { key: "bilan", label: "Bilan comptable", match: ["bilan"] },
    { key: "compte_resultat", label: "Compte de résultat", match: ["resultat", "résultat"] },
    { key: "conventions", label: "Conventions de formation", match: ["convention"] },
  ],
  cfa: [
    { key: "kbis", label: "KBIS", match: ["kbis"] },
    { key: "nda", label: "NDA", match: ["nda"] },
    { key: "reglement", label: "Règlement intérieur", match: ["reglement", "règlement"] },
    { key: "programme", label: "Programmes pédagogiques", match: ["programme"] },
  ],
  vae: [
    { key: "cni", label: "Carte d'identité (recto/verso)", match: ["cni", "identite", "identité", "passeport"] },
    { key: "cv", label: "CV détaillé", match: ["cv", "curriculum"] },
    { key: "diplome", label: "Diplômes obtenus", match: ["diplome", "diplôme"] },
    { key: "attestations", label: "Attestations de travail", match: ["attestation"] },
  ],
  edof: [
    { key: "kbis", label: "KBIS", match: ["kbis"] },
    { key: "qualiopi", label: "Certificat Qualiopi", match: ["qualiopi"] },
    { key: "catalogue", label: "Catalogue de formations", match: ["catalogue"] },
  ],
  contrats: [
    { key: "kbis", label: "KBIS", match: ["kbis"] },
    { key: "cni", label: "Carte d'identité du signataire", match: ["cni", "identite", "identité"] },
    { key: "rib", label: "RIB", match: ["rib"] },
  ],
  documents_administratifs: [],
  autres: [],
};

export const requiredDocsFor = (categorie: string): RequiredDoc[] =>
  REQUIRED_DOCUMENTS[categorie] ?? [];

export const docMatches = (fileName: string, req: RequiredDoc): boolean => {
  const n = fileName.toLowerCase();
  return req.match.some((kw) => n.includes(kw.toLowerCase()));
};


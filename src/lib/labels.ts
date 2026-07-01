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

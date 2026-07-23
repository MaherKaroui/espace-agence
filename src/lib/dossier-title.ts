import { categorieLabel } from "@/lib/labels";

// Préfixe de titre par catégorie de demande.
// Doit rester identique côté client (wizard), admin (formulaire) et affichages.
const TITRE_BASE: Record<string, string> = {
  edof: "Dossier EDOF / CPF",
  qualiopi: "Demande Certification Qualiopi",
  nda: "Demande de NDA",
  bpf: "BPF annuel",
  cfa: "Création ou gestion CFA",
  vae: "VAE",
  contrats: "Contrats",
  documents_administratifs: "Documents administratifs",
  autres: "Autre demande",
};

export function baseTitreFor(categorie: string): string {
  return TITRE_BASE[categorie] ?? categorieLabel(categorie);
}

export function buildDossierTitre(categorie: string, organismeNom?: string | null): string {
  const base = baseTitreFor(categorie);
  const n = (organismeNom ?? "").trim();
  return n ? `${base} - ${n}` : base;
}

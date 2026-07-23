import { categorieLabel } from "@/lib/labels";

// Préfixe de titre par catégorie de demande.
// Doit rester identique côté client (wizard), admin (formulaire) et affichages
// — et cohérent avec la fonction SQL `dossier_title_from_of`.
const TITRE_BASE: Record<string, string> = {
  edof: "Dossier EDOF / CPF",
  qualiopi: "Demande Certification Qualiopi",
  nda: "Demande de NDA",
  bpf: "BPF annuel",
  cfa: "Création ou gestion CFA",
  vae: "VAE",
  juridique: "Juridique",
  contrats: "Contrats",
  documents_administratifs: "Documents administratifs",
  autres: "Autre demande",
};

export function baseTitreFor(categorie: string, juridiqueType?: string | null): string {
  const base = TITRE_BASE[categorie] ?? categorieLabel(categorie);
  if (categorie === "juridique") {
    const t = (juridiqueType ?? "").trim();
    return t ? `${base} — ${t}` : base;
  }
  return base;
}

export function buildDossierTitre(
  categorie: string,
  organismeNom?: string | null,
  juridiqueType?: string | null,
): string {
  const base = baseTitreFor(categorie, juridiqueType);
  const n = (organismeNom ?? "").trim();
  return n ? `${base} - ${n}` : base;
}


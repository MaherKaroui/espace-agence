import { categorieLabel } from "@/lib/labels";

// Suffixe de titre par catégorie de demande — format « NOM OF - DEMANDE XXX ».
// Doit rester identique côté client (wizard), admin (formulaire) et affichages
// — et cohérent avec la fonction SQL `dossier_title_from_of`.
const TITRE_BASE: Record<string, string> = {
  edof: "DEMANDE EDOF",
  qualiopi: "DEMANDE QUALIOPI",
  nda: "DEMANDE NDA",
  bpf: "BPF ANNUEL",
  cfa: "DEMANDE CFA",
  vae: "DEMANDE VAE",
  juridique: "JURIDIQUE",
  contrats: "CONTRATS",
  documents_administratifs: "DOCUMENTS ADMINISTRATIFS",
  autres: "AUTRE DEMANDE",
};

export function baseTitreFor(categorie: string, juridiqueType?: string | null): string {
  const base = TITRE_BASE[categorie] ?? categorieLabel(categorie).toUpperCase();
  if (categorie === "juridique") {
    const t = (juridiqueType ?? "").trim();
    return t ? `${base} — ${t.toUpperCase()}` : base;
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
  return n ? `${n.toUpperCase()} - ${base}` : base;
}



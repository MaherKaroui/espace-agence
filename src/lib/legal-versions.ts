// Versions des documents légaux — incrémenter pour redemander l'acceptation.
export const LEGAL_VERSIONS = {
  cgu: "1.0",
  privacy: "1.0",
  logging_notice: "1.0",
} as const;

export type LegalDocumentType = keyof typeof LEGAL_VERSIONS;

export const LEGAL_LABELS: Record<LegalDocumentType, string> = {
  cgu: "Conditions Générales d'Utilisation",
  privacy: "Politique de confidentialité",
  logging_notice: "Information sur la journalisation",
};

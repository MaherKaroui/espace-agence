// Coordonnées obligatoires de l'organisme de formation (exigence d'audit Qualiopi).
// Règle unique partagée par les formulaires de création, l'édition du dossier
// et les changements de statut — cohérente avec l'anomalie « dossiers_incomplete »
// remontée par la supervision.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function ofEmailError(email?: string | null): string | null {
  const v = (email ?? "").trim();
  if (!v) return "E-mail de l'OF requis";
  return EMAIL_RE.test(v) ? null : "E-mail de l'OF invalide";
}

export function ofTelephoneError(telephone?: string | null): string | null {
  const v = (telephone ?? "").trim();
  if (!v) return "Téléphone de l'OF requis";
  return v.replace(/\D/g, "").length >= 8 ? null : "Téléphone de l'OF invalide (8 chiffres minimum)";
}

/** Première erreur trouvée, ou null si l'e-mail et le téléphone sont valides. */
export function ofContactError(email?: string | null, telephone?: string | null): string | null {
  return ofEmailError(email) ?? ofTelephoneError(telephone);
}

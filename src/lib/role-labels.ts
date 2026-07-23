export const ROLE_LABELS_FR: Record<string, string> = {
  admin: "Administration",
  direction: "Direction",
  manager: "Responsable",
  consultant: "Collaborateur",
  auditeur: "Auditeur",
  certificateur: "Certificateur",
  client: "Client",
};

export const roleLabelFr = (role: string): string => ROLE_LABELS_FR[role] ?? role;

// Rôles assignables à un membre de pôle (hors admin/direction/client)
export const POLE_MEMBER_ROLES: { value: "manager" | "consultant"; label: string }[] = [
  { value: "manager", label: "Responsable" },
  { value: "consultant", label: "Collaborateur" },
];

// Rôles externes (professionnels rattachés à un dossier via dossier_assignments)
export const EXTERNAL_ROLES: { value: "auditeur" | "certificateur"; label: string }[] = [
  { value: "auditeur", label: "Auditeur" },
  { value: "certificateur", label: "Certificateur" },
];

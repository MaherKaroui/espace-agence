// Ajoute une ancre pertinente à un lien de notification.
// - qualiopi_message  → #audit-chat (canal d'audit)
// - autres qualiopi_* → #qualiopi (panneau demandes Qualiopi)
export function notifTargetLink(type: string, link: string | null | undefined): string {
  if (!link) return "/dashboard";
  if (link.includes("#")) return link;
  if (type === "qualiopi_message") return `${link}#audit-chat`;
  if (type.startsWith("qualiopi_")) return `${link}#qualiopi`;
  return link;
}

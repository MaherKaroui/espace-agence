// Mapping types techniques (colonne notifications.type) -> catégorie d'événement
// utilisée pour les préférences utilisateur et l'icône du toast.

import { MessageSquare, FileText, ListChecks, Calendar, Shield, Bell, type LucideIcon } from "lucide-react";

export type EventCategory =
  | "chat"
  | "document"
  | "tache"
  | "rdv"
  | "securite"
  | "autre";

export const EVENT_CATEGORIES: { key: EventCategory; label: string; description: string }[] = [
  { key: "chat", label: "Messagerie", description: "Nouveaux messages dans vos dossiers" },
  { key: "document", label: "Documents", description: "Dépôts, demandes de pièces, téléchargements" },
  { key: "tache", label: "Tâches", description: "Tâche assignée, échéance, déblocage, attente client" },
  { key: "rdv", label: "Rendez-vous", description: "Nouveau RDV, modification, rappel" },
  { key: "securite", label: "Alertes sécurité", description: "Coordonnées masquées, connexions suspectes (admin/direction uniquement)" },
];

export function categoryOf(type: string): EventCategory {
  if (type === "message" || type === "internal_message") return "chat";
  if (type.startsWith("document")) return "document";
  if (type.startsWith("tache")) return "tache";
  if (type.startsWith("rdv")) return "rdv";
  if (type === "alerte" || type.startsWith("securite") || type === "rapport_quotidien") return "securite";
  if (type === "statut_change") return "tache";
  return "autre";
}

export function iconOf(type: string): LucideIcon {
  const c = categoryOf(type);
  switch (c) {
    case "chat": return MessageSquare;
    case "document": return FileText;
    case "tache": return ListChecks;
    case "rdv": return Calendar;
    case "securite": return Shield;
    default: return Bell;
  }
}

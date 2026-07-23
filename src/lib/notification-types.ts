// Mapping types techniques (colonne notifications.type) -> catégorie d'événement
// utilisée pour les préférences utilisateur et l'icône du toast.

import { MessageSquare, FileText, ListChecks, Calendar, Shield, Bell, ShieldCheck, type LucideIcon } from "lucide-react";

export type EventCategory =
  | "chat"
  | "document"
  | "tache"
  | "rdv"
  | "securite"
  | "qualiopi"
  | "autre";

export const EVENT_CATEGORIES: { key: EventCategory; label: string; description: string }[] = [
  { key: "chat", label: "Messagerie", description: "Nouveaux messages dans vos dossiers" },
  { key: "document", label: "Documents", description: "Dépôts, demandes de pièces, téléchargements" },
  { key: "tache", label: "Tâches", description: "Tâche assignée, échéance, déblocage, attente client" },
  { key: "rdv", label: "Rendez-vous", description: "Nouveau RDV, modification, rappel" },
  { key: "qualiopi", label: "Audit Qualiopi", description: "Demandes de pièces, validations, refus, échéances, messages du canal d'audit" },
  { key: "securite", label: "Alertes sécurité", description: "Coordonnées masquées, connexions suspectes (admin/direction uniquement)" },
];

export function categoryOf(type: string): EventCategory {
  if (type.startsWith("qualiopi")) return "qualiopi";
  if (type === "message" || type === "internal_message" || type === "internal_mention") return "chat";
  if (type.startsWith("document")) return "document";
  if (type === "agency_task" || type.startsWith("tache")) return "tache";
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
    case "qualiopi": return ShieldCheck;
    case "securite": return Shield;
    default: return Bell;
  }
}

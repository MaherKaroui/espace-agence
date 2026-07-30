import { cn } from "@/lib/utils";
import { Bot, Hand } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Priority = Database["public"]["Enums"]["agency_task_priority"];
type Status = Database["public"]["Enums"]["agency_task_status"];

export const PRIORITY_LABELS: Record<Priority, string> = {
  basse: "Basse",
  normale: "Normale",
  haute: "Haute",
  urgente: "Urgente",
};

export const STATUS_LABELS: Record<Status, string> = {
  a_faire: "À faire",
  en_cours: "En cours",
  en_attente: "En attente",
  bloquee: "Bloquée",
  terminee: "Terminée",
};

export const STATUS_ORDER: Status[] = ["a_faire", "en_cours", "en_attente", "bloquee", "terminee"];

const PRIORITY_CLASSES: Record<Priority, string> = {
  urgente: "bg-red-500/15 text-red-600 border border-red-500/30",
  haute: "bg-orange-500/15 text-orange-600 border border-orange-500/30",
  normale: "bg-blue-500/15 text-blue-600 border border-blue-500/30",
  basse: "bg-muted text-muted-foreground border border-border",
};

const STATUS_CLASSES: Record<Status, string> = {
  a_faire: "bg-muted text-foreground border border-border",
  en_cours: "bg-blue-500/15 text-blue-600 border border-blue-500/30",
  en_attente: "bg-violet-500/15 text-violet-700 border border-violet-500/30",
  bloquee: "bg-amber-500/15 text-amber-700 border border-amber-500/30",
  terminee: "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30",
};

export function PriorityBadge({ value, className }: { value: Priority; className?: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", PRIORITY_CLASSES[value], className)}>
      {PRIORITY_LABELS[value]}
    </span>
  );
}

export function StatusBadge({ value, className }: { value: Status; className?: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", STATUS_CLASSES[value], className)}>
      {STATUS_LABELS[value]}
    </span>
  );
}

export function OriginBadge({ auto, className }: { auto: boolean | null | undefined; className?: string }) {
  if (auto) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide",
          "bg-violet-500/20 text-violet-700 border border-violet-500/40",
          className,
        )}
      >
        <Bot className="h-3.5 w-3.5" /> Auto
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border", className)}>
      <Hand className="h-3 w-3" /> Manuel
    </span>
  );
}

export function priorityRank(p: Priority): number {
  return { urgente: 0, haute: 1, normale: 2, basse: 3 }[p];
}

export function isOverdue(due: string | null | undefined, status: Status): boolean {
  if (!due || status === "terminee") return false;
  return new Date(due).getTime() < Date.now();
}

export function daysLate(due: string | null | undefined, status: Status): number {
  if (!isOverdue(due, status)) return 0;
  return Math.max(1, Math.floor((Date.now() - new Date(due!).getTime()) / 86400000));
}

export type TaskTone = "archived" | "done" | "overdue" | "today" | "soon" | "auto" | "normal";

export function taskTone(t: {
  due_date: string | null;
  status: Status;
  archived_at?: string | null;
  auto?: boolean | null;
}): TaskTone {
  if (t.archived_at) return "archived";
  if (t.status === "terminee") return "done";
  if (isOverdue(t.due_date, t.status)) return "overdue";
  if (t.due_date) {
    const d = new Date(t.due_date).getTime();
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
    if (d <= endOfDay.getTime()) return "today";
    if (d - Date.now() < 48 * 3600 * 1000) return "soon";
  }
  if (t.auto) return "auto";
  return "normal";
}

export const TONE_LABELS: Record<TaskTone, string> = {
  archived: "Archivée",
  done: "Terminée",
  overdue: "En retard",
  today: "Échéance aujourd'hui",
  soon: "Échéance < 48 h",
  auto: "Tâche automatique",
  normal: "Sans urgence",
};

/** Classes appliquées à la carte entière : bande verticale gauche + fond teinté. */
export const TONE_CARD_CLASSES: Record<TaskTone, string> = {
  overdue: "border-l-4 border-l-red-500 bg-red-500/10",
  today: "border-l-4 border-l-orange-500 bg-orange-500/10",
  soon: "border-l-4 border-l-yellow-500 bg-yellow-400/10",
  auto: "border-l-4 border-l-violet-500 bg-violet-500/10",
  normal: "border-l-4 border-l-blue-400 bg-blue-500/5",
  done: "border-l-4 border-l-emerald-500 bg-emerald-500/10",
  archived: "border-l-4 border-l-muted-foreground/40 bg-muted/60 opacity-80",
};

export const TONE_DOT_CLASSES: Record<TaskTone, string> = {
  overdue: "bg-red-500",
  today: "bg-orange-500",
  soon: "bg-yellow-400",
  auto: "bg-violet-500",
  normal: "bg-blue-400",
  done: "bg-emerald-500",
  archived: "bg-muted-foreground/40",
};

export const TASK_TYPE_RULES: Record<string, string> = {
  nouveau_dossier: "Création d'un dossier — prise en charge sous 3 jours",
  document_a_verifier: "Document déposé par le client — vérification sous 24 h",
  client_sans_reponse: "Client sans réponse — relance sous 3 jours",
  dossier_bloque: "Dossier bloqué — traitement immédiat",
};

type SortableTask = {
  priority: Priority;
  status: Status;
  due_date: string | null;
  auto?: boolean | null;
};

/** urgente > retard > échéance proche > manuel > auto */
export function sortByUrgency(a: SortableTask, b: SortableTask): number {
  const ao = isOverdue(a.due_date, a.status);
  const bo = isOverdue(b.due_date, b.status);
  const aScore = a.priority === "urgente" ? -1 : ao ? -0.5 : priorityRank(a.priority);
  const bScore = b.priority === "urgente" ? -1 : bo ? -0.5 : priorityRank(b.priority);
  if (aScore !== bScore) return aScore - bScore;
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date);
  if (a.due_date && !b.due_date) return -1;
  if (!a.due_date && b.due_date) return 1;
  return (a.auto ? 1 : 0) - (b.auto ? 1 : 0);
}

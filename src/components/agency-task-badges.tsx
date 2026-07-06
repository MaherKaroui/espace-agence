import { cn } from "@/lib/utils";
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
  bloquee: "Bloquée",
  terminee: "Terminée",
};

const PRIORITY_CLASSES: Record<Priority, string> = {
  urgente: "bg-red-500/15 text-red-600 border border-red-500/30",
  haute: "bg-orange-500/15 text-orange-600 border border-orange-500/30",
  normale: "bg-blue-500/15 text-blue-600 border border-blue-500/30",
  basse: "bg-muted text-muted-foreground border border-border",
};

const STATUS_CLASSES: Record<Status, string> = {
  a_faire: "bg-muted text-foreground border border-border",
  en_cours: "bg-blue-500/15 text-blue-600 border border-blue-500/30",
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

export function priorityRank(p: Priority): number {
  return { urgente: 0, haute: 1, normale: 2, basse: 3 }[p];
}

export function isOverdue(due: string | null | undefined, status: Status): boolean {
  if (!due || status === "terminee") return false;
  return new Date(due).getTime() < Date.now();
}

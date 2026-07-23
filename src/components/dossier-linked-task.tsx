import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ListChecks, ExternalLink, AlertTriangle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { PriorityBadge, StatusBadge } from "@/components/agency-task-badges";
import { useState } from "react";
import { AgencyTaskDetailDialog } from "@/components/agency-task-detail-dialog";

export function DossierLinkedTask({ dossierId }: { dossierId: string }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: task } = useQuery({
    queryKey: ["dossier-linked-task", dossierId],
    queryFn: async () => {
      const { data } = await supabase
        .from("agency_tasks")
        .select("id, title, status, priority, due_date, assigned_to, pole_id, auto, task_type")
        .eq("dossier_id", dossierId)
        .eq("task_type", "nouveau_dossier")
        .maybeSingle();
      return data;
    },
  });

  const { data: assignee } = useQuery({
    queryKey: ["dossier-linked-task-assignee", task?.assigned_to],
    enabled: !!task?.assigned_to,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, nom, prenom, email")
        .eq("id", task!.assigned_to!)
        .maybeSingle();
      return data;
    },
  });

  if (!task) return null;

  const assigneeLabel = assignee
    ? `${assignee.prenom ?? ""} ${assignee.nom ?? ""}`.trim() || assignee.email || "—"
    : "Non assigné";

  const fmtDue = task.due_date
    ? new Date(task.due_date).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
  const overdue = task.due_date && task.status !== "terminee" && new Date(task.due_date) < new Date();

  return (
    <>
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-gold" />
            Tâche liée
          </h3>
          {task.auto && (
            <Badge variant="outline" className="text-xs bg-gold/10 border-gold/40 text-gold-foreground">
              auto
            </Badge>
          )}
        </div>

        <div className="space-y-2 text-sm">
          <div className="font-medium">{task.title}</div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={task.status} />
            <PriorityBadge value={task.priority} />
            {overdue && (
              <span className="inline-flex items-center gap-1 text-xs text-red-600">
                <AlertTriangle className="h-3 w-3" /> En retard
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            Assignée à <span className="font-medium text-foreground">{assigneeLabel}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Échéance : <span className={overdue ? "text-red-600 font-medium" : "text-foreground"}>{fmtDue}</span>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <Button size="sm" variant="outline" onClick={() => setOpenId(task.id)}>
            Ouvrir la tâche
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link to="/admin/taches-agence">
              Toutes les tâches <ExternalLink className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        </div>
      </Card>

      <AgencyTaskDetailDialog
        taskId={openId}
        open={!!openId}
        onOpenChange={(o) => !o && setOpenId(null)}
      />
    </>
  );
}

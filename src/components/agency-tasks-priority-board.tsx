import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, AlertTriangle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { PriorityBadge, StatusBadge, isOverdue, priorityRank } from "./agency-task-badges";
import { AgencyTaskFormDialog } from "./agency-task-form-dialog";
import { AgencyTaskDetailDialog } from "./agency-task-detail-dialog";
import type { Database } from "@/integrations/supabase/types";

type Task = Database["public"]["Tables"]["agency_tasks"]["Row"];

export function AgencyTasksPriorityBoard() {
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: tasks = [] } = useQuery({
    queryKey: ["agency-tasks", "priority-board"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agency_tasks")
        .select("*")
        .is("archived_at", null)
        .neq("status", "terminee")
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

  const { data: profilesMap = {} } = useQuery({
    queryKey: ["agency-tasks", "assignees", tasks.map((t) => t.assigned_to).filter(Boolean).join(",")],
    enabled: tasks.length > 0,
    queryFn: async () => {
      const ids = Array.from(new Set(tasks.map((t) => t.assigned_to).filter(Boolean))) as string[];
      if (!ids.length) return {};
      const { data } = await supabase.from("profiles").select("id, nom, prenom, email").in("id", ids);
      return Object.fromEntries((data ?? []).map((p) => [p.id, `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || p.id]));
    },
  });

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const ao = isOverdue(a.due_date, a.status);
      const bo = isOverdue(b.due_date, b.status);
      const aScore = (a.priority === "urgente" && ao ? -1 : priorityRank(a.priority));
      const bScore = (b.priority === "urgente" && bo ? -1 : priorityRank(b.priority));
      if (aScore !== bScore) return aScore - bScore;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    }).slice(0, 8);
  }, [tasks]);

  const fmtDue = (d: string | null) => d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—";

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg">Priorités du jour</h2>
          <p className="text-xs text-muted-foreground">Tâches internes agence · triées par urgence</p>
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Créer une tâche
          </Button>
          <Link to="/admin/taches-agence"><Button size="sm" variant="outline">Voir tout</Button></Link>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">Aucune tâche en cours. Créez-en une pour organiser la journée.</div>
      ) : (
        <div className="divide-y">
          {sorted.map((t) => {
            const overdue = isOverdue(t.due_date, t.status);
            return (
              <button
                key={t.id}
                onClick={() => setDetailId(t.id)}
                className="w-full py-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 text-left hover:bg-muted/40 transition rounded px-2"
              >
                <div className="flex-shrink-0 flex gap-1 pt-0.5">
                  <PriorityBadge value={t.priority} />
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-sm flex items-start gap-2">
                    <span className="line-clamp-2 break-words">{t.title}</span>
                    {overdue && <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {t.assigned_to ? profilesMap[t.assigned_to] ?? "…" : "Non assigné"}
                    {" · "}
                    <span className={overdue ? "text-red-600 font-medium" : ""}>
                      {t.due_date ? (overdue ? "En retard : " : "Échéance : ") : ""}
                      {t.due_date ? fmtDue(t.due_date) : "Aucune échéance"}
                    </span>
                  </div>
                </div>
                <div className="shrink-0"><StatusBadge value={t.status} /></div>
              </button>

            );
          })}
        </div>
      )}

      <AgencyTaskFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <AgencyTaskDetailDialog taskId={detailId} open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)} />
    </Card>
  );
}

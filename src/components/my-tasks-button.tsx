import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ListChecks } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type Task = Database["public"]["Tables"]["agency_tasks"]["Row"];
type Priority = Database["public"]["Enums"]["agency_task_priority"];
type Status = Database["public"]["Enums"]["agency_task_status"];

const PRIORITY_LABELS: Record<Priority, string> = {
  basse: "Basse",
  normale: "Normale",
  haute: "Haute",
  urgente: "Urgente",
};
const PRIORITY_RANK: Record<Priority, number> = { urgente: 0, haute: 1, normale: 2, basse: 3 };

const STATUS_LABELS: Record<string, string> = {
  a_faire: "À faire",
  en_cours: "En cours",
  en_attente: "En attente",
  bloquee: "Bloquée",
  terminee: "Terminée",
};

type Enriched = Task & { context: string | null };

const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" });

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

type GroupKey = "retard" | "aujourdhui" | "semaine" | "plus_tard" | "sans";

const GROUPS: { key: GroupKey; label: string; className?: string }[] = [
  { key: "retard", label: "En retard", className: "text-destructive" },
  { key: "aujourdhui", label: "Aujourd'hui", className: "text-amber-600 dark:text-amber-400" },
  { key: "semaine", label: "Cette semaine" },
  { key: "plus_tard", label: "Plus tard" },
  { key: "sans", label: "Sans échéance" },
];

function groupOf(due: string | null): GroupKey {
  if (!due) return "sans";
  const today = startOfToday();
  const d = new Date(due);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "retard";
  if (diff === 0) return "aujourdhui";
  if (diff <= 7) return "semaine";
  return "plus_tard";
}

export function MyTasksButton() {
  const { user } = useAuth();
  const { isStaff } = useRole();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const queryKey = ["my-agency-tasks", user?.id];

  const { data: tasks = [] } = useQuery({
    queryKey,
    enabled: !!user && isStaff,
    queryFn: async (): Promise<Enriched[]> => {
      const uid = user!.id;
      const { data: extra } = await supabase
        .from("agency_task_assignees")
        .select("task_id")
        .eq("user_id", uid);
      const extraIds = Array.from(new Set((extra ?? []).map((r) => r.task_id)));

      const base = () =>
        supabase
          .from("agency_tasks")
          .select("*")
          .is("archived_at", null)
          .neq("status", "terminee");

      const [own, viaAssignees] = await Promise.all([
        base().eq("assigned_to", uid),
        extraIds.length ? base().in("id", extraIds) : Promise.resolve({ data: [] as Task[] }),
      ]);

      const map = new Map<string, Task>();
      for (const t of [...((own.data ?? []) as Task[]), ...(((viaAssignees as any).data ?? []) as Task[])]) {
        map.set(t.id, t);
      }
      const list = Array.from(map.values());
      if (list.length === 0) return [];

      const dossierIds = Array.from(new Set(list.map((t) => t.dossier_id).filter(Boolean))) as string[];
      const clientIds = Array.from(new Set(list.map((t) => t.client_id).filter(Boolean))) as string[];
      const poleIds = Array.from(new Set(list.map((t) => t.pole_id).filter(Boolean))) as string[];

      const [dossiers, clients, poles] = await Promise.all([
        dossierIds.length
          ? supabase.from("dossiers").select("id, titre").in("id", dossierIds)
          : Promise.resolve({ data: [] as any[] }),
        clientIds.length
          ? supabase.from("profiles").select("id, nom, prenom, entreprise").in("id", clientIds)
          : Promise.resolve({ data: [] as any[] }),
        poleIds.length
          ? supabase.from("poles").select("id, nom").in("id", poleIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const dMap = new Map((dossiers.data ?? []).map((d: any) => [d.id, d.titre as string]));
      const cMap = new Map(
        (clients.data ?? []).map((c: any) => [
          c.id,
          (c.entreprise as string) || `${c.prenom ?? ""} ${c.nom ?? ""}`.trim(),
        ]),
      );
      const pMap = new Map((poles.data ?? []).map((p: any) => [p.id, p.nom as string]));

      return list.map((t) => ({
        ...t,
        context:
          (t.dossier_id && dMap.get(t.dossier_id)) ||
          (t.client_id && cMap.get(t.client_id)) ||
          (t.pole_id && pMap.get(t.pole_id)) ||
          null,
      }));
    },
  });

  // Temps réel
  useEffect(() => {
    if (!user || !isStaff) return;
    const channel = supabase.channel(`my-tasks-${user.id}-${Math.random().toString(36).slice(2)}`);
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "agency_tasks" },
      () => qc.invalidateQueries({ queryKey: ["my-agency-tasks", user.id] }),
    );
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "agency_task_assignees" },
      () => qc.invalidateQueries({ queryKey: ["my-agency-tasks", user.id] }),
    );
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, isStaff, qc]);

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      if (da !== db) return da - db;
      return PRIORITY_RANK[a.priority as Priority] - PRIORITY_RANK[b.priority as Priority];
    });
  }, [tasks]);

  const urgentCount = useMemo(
    () => sorted.filter((t) => ["retard", "aujourdhui"].includes(groupOf(t.due_date))).length,
    [sorted],
  );

  const grouped = useMemo(() => {
    const shown = sorted.slice(0, 30);
    return GROUPS.map((g) => ({ ...g, items: shown.filter((t) => groupOf(t.due_date) === g.key) })).filter(
      (g) => g.items.length > 0,
    );
  }, [sorted]);

  const rest = Math.max(0, sorted.length - 30);

  const complete = async (id: string) => {
    const { error } = await supabase
      .from("agency_tasks")
      .update({ status: "terminee" as Status, completed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error("Impossible de terminer la tâche");
      return;
    }
    toast.success("Tâche terminée");
    qc.invalidateQueries({ queryKey: ["my-agency-tasks", user?.id] });
    qc.invalidateQueries({ queryKey: ["agency-tasks"] });
  };

  if (!isStaff) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Mes tâches">
          <ListChecks className="h-5 w-5" />
          {urgentCount > 0 && (
            <span className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full bg-gold text-[10px] font-semibold text-primary flex items-center justify-center">
              {urgentCount > 99 ? "99+" : urgentCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,24rem)] p-0">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <div className="font-medium">Mes tâches</div>
          <span className="text-xs text-muted-foreground">
            {sorted.length} en cours
          </span>
        </div>

        <div className="max-h-[26rem] overflow-y-auto overflow-x-hidden">
          {sorted.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Aucune tâche en cours. Tout est à jour.
            </div>
          )}
          {grouped.map((g) => (
            <div key={g.key}>
              <div className={cn("px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide bg-muted/50", g.className)}>
                {g.label} ({g.items.length})
              </div>
              {g.items.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    "flex items-start gap-3 border-b px-4 py-3 hover:bg-muted/50 transition-colors",
                    t.status === "bloquee" && "border-l-2 border-l-destructive bg-destructive/5",
                  )}
                >
                  <Checkbox
                    className="mt-1 shrink-0"
                    aria-label="Marquer terminée"
                    onCheckedChange={(v) => { if (v) complete(t.id); }}
                  />
                  <button
                    type="button"
                    onClick={() => navigate({ to: "/admin/taches-agence", search: { task: t.id } })}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-sm font-medium">{t.title}</div>
                    {t.context && (
                      <div className="truncate text-xs text-muted-foreground">{t.context}</div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                      {t.due_date && (
                        <span className={cn("text-muted-foreground", g.key === "retard" && "text-destructive font-medium")}>
                          {dateFmt.format(new Date(t.due_date))}
                        </span>
                      )}
                      <span className="rounded-full bg-muted px-2 py-0.5">
                        {PRIORITY_LABELS[t.priority as Priority]}
                      </span>
                      <span className={cn("rounded-full px-2 py-0.5", t.status === "bloquee" ? "bg-destructive/15 text-destructive font-medium" : "bg-muted")}>
                        {STATUS_LABELS[t.status] ?? t.status}
                      </span>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          ))}
          {rest > 0 && (
            <div className="px-4 py-2 text-xs text-muted-foreground">… et {rest} autres</div>
          )}
        </div>

        <div className="border-t bg-muted/30 p-2">
          <Link to="/admin/taches-agence" className="block py-1 text-center text-xs text-primary hover:underline">
            Voir toutes mes tâches →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

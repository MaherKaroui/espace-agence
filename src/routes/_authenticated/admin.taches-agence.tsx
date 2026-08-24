import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMyTaskIds } from "@/hooks/use-my-tasks";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, AlertTriangle, ListChecks, LayoutGrid, List as ListIcon } from "lucide-react";
import {
  PriorityBadge, StatusBadge, OriginBadge, isOverdue, daysLate,
  taskTone, TONE_CARD_CLASSES, TONE_DOT_CLASSES, TONE_LABELS, STATUS_LABELS, STATUS_ORDER, sortByUrgency,
} from "@/components/agency-task-badges";
import { AgencyTaskFormDialog } from "@/components/agency-task-form-dialog";
import { AgencyTaskDetailDialog } from "@/components/agency-task-detail-dialog";
import { AgencyTasksKanbanBoard } from "@/components/agency-tasks-kanban";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type Task = Database["public"]["Tables"]["agency_tasks"]["Row"];
type Status = Database["public"]["Enums"]["agency_task_status"];

export const Route = createFileRoute("/_authenticated/admin/taches-agence")({
  validateSearch: (search: Record<string, unknown>): { task?: string; mine?: string } => {
    const out: { task?: string; mine?: string } = {};
    if (typeof search.task === "string") out.task = search.task;
    if (search.mine === "1" || search.mine === 1 || search.mine === true) out.mine = "1";
    return out;
  },
  head: () => ({ meta: [{ title: "Tâches agence" }] }),
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const ok = roles?.some((r) => ["admin","direction","manager","consultant"].includes(r.role));
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: AgencyTasksPage,
});

const ALL = "all";

const QUICK_FILTERS = [
  { value: "all", label: "Toutes" },
  { value: "auto", label: "Auto uniquement" },
  { value: "manual", label: "Manuelles uniquement" },
  { value: "overdue", label: "En retard" },
  { value: "unassigned", label: "Sans assigné" },
  { value: "urgent", label: "Urgentes" },
] as const;

const KANBAN_COLUMNS: { status: Status; label: string }[] = [
  { status: "a_faire", label: "À faire" },
  { status: "en_cours", label: "En cours" },
  { status: "en_attente", label: "En attente client" },
  { status: "bloquee", label: "Bloqué" },
  { status: "terminee", label: "Terminé" },
];

function AgencyTasksPage() {
  const { user } = useAuth();
  const { isStaff } = useRole();
  const [createOpen, setCreateOpen] = useState(false);
  const { task: taskParam, mine: mineParam } = Route.useSearch();
  const navigate = useNavigate();
  const onlyMine = mineParam === "1";
  const { idSet: myTaskIds } = useMyTaskIds();
  const setOnlyMine = (v: boolean) =>
    navigate({ to: "/admin/taches-agence", search: (prev: any) => ({ ...prev, mine: v ? "1" : undefined }) });
  const [detailId, setDetailId] = useState<string | null>(taskParam ?? null);
  useEffect(() => { if (taskParam) setDetailId(taskParam); }, [taskParam]);
  const [tab, setTab] = useState("priority");
  const [view, setView] = useState<"list" | "kanban">("list");
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [poleFilter, setPoleFilter] = useState<string>(ALL);
  const [dossierFilter, setDossierFilter] = useState<string>(ALL);
  const [autoFilter, setAutoFilter] = useState<string>(ALL);
  const [quick, setQuick] = useState<string>("all");

  const { data: poles = [] } = useQuery({
    queryKey: ["poles-list"],
    queryFn: async () => {
      const { data } = await supabase.from("poles").select("id, nom").eq("actif", true).order("nom");
      return data ?? [];
    },
  });

  const { data: dossiersList = [] } = useQuery({
    queryKey: ["dossiers-for-task-filter"],
    queryFn: async () => {
      const { data } = await supabase.from("dossiers").select("id, titre").order("created_at", { ascending: false }).limit(200);
      return data ?? [];
    },
  });

  // On charge toujours tout (archivées comprises) pour pouvoir compter les onglets.
  const { data: tasks = [] } = useQuery({
    queryKey: ["agency-tasks", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agency_tasks")
        .select("*")
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

  const { data: profilesMap = {} } = useQuery({
    queryKey: ["agency-tasks-profiles", tasks.length],
    enabled: tasks.length > 0,
    queryFn: async () => {
      const ids = Array.from(new Set(tasks.flatMap((t) => [t.assigned_to, t.created_by]).filter(Boolean))) as string[];
      if (!ids.length) return {};
      const { data } = await supabase.from("profiles").select("id, nom, prenom, email").in("id", ids);
      return Object.fromEntries((data ?? []).map((p) => [p.id, `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || p.id]));
    },
  });

  const polesMap = useMemo(() => Object.fromEntries(poles.map((p) => [p.id, p.nom])), [poles]);

  const bounds = () => {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
    return { now: new Date(), startOfDay, endOfDay, weekAgo: new Date(Date.now() - 7 * 24 * 3600 * 1000) };
  };

  const counts = useMemo(() => {
    const { now, startOfDay, endOfDay, weekAgo } = bounds();
    const live = tasks.filter((t) => !t.archived_at);
    const open = live.filter((t) => t.status !== "terminee");
    return {
      priority: open.length,
      today: open.filter((t) => t.due_date && new Date(t.due_date) >= startOfDay && new Date(t.due_date) <= endOfDay).length,
      overdue: open.filter((t) => t.due_date && new Date(t.due_date) < now).length,
      mine: open.filter((t) => t.assigned_to === user?.id).length,
      team: open.length,
      auto: open.filter((t) => !!t.auto).length,
      done: live.filter((t) => t.status === "terminee" && t.completed_at && new Date(t.completed_at) >= weekAgo).length,
      archived: tasks.filter((t) => !!t.archived_at).length,
    };
  }, [tasks, user?.id]);

  const filtered = useMemo(() => {
    const { now, startOfDay, endOfDay, weekAgo } = bounds();

    let list = tasks;
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      list = list.filter((t) => t.title.toLowerCase().includes(s) || (t.description ?? "").toLowerCase().includes(s));
    }
    if (priorityFilter !== ALL) list = list.filter((t) => t.priority === priorityFilter);
    if (statusFilter !== ALL) list = list.filter((t) => t.status === statusFilter);
    if (poleFilter !== ALL) list = list.filter((t) => t.pole_id === poleFilter);
    if (dossierFilter !== ALL) list = list.filter((t) => t.dossier_id === dossierFilter);
    if (autoFilter === "auto") list = list.filter((t) => !!t.auto);
    else if (autoFilter === "manual") list = list.filter((t) => !t.auto);

    switch (quick) {
      case "auto": list = list.filter((t) => !!t.auto); break;
      case "manual": list = list.filter((t) => !t.auto); break;
      case "overdue": list = list.filter((t) => isOverdue(t.due_date, t.status)); break;
      case "unassigned": list = list.filter((t) => !t.assigned_to); break;
      case "urgent": list = list.filter((t) => t.priority === "urgente"); break;
    }

    if (tab !== "archived") list = list.filter((t) => !t.archived_at);

    switch (tab) {
      case "priority":
        list = list.filter((t) => t.status !== "terminee");
        list = [...list].sort(sortByUrgency);
        break;
      case "today":
        list = list.filter((t) => t.status !== "terminee" && t.due_date && new Date(t.due_date) >= startOfDay && new Date(t.due_date) <= endOfDay);
        break;
      case "overdue":
        list = list.filter((t) => t.status !== "terminee" && t.due_date && new Date(t.due_date) < now);
        break;
      case "mine":
        list = list.filter((t) => t.assigned_to === user?.id && t.status !== "terminee");
        break;
      case "team":
        list = list.filter((t) => t.status !== "terminee");
        break;
      case "auto":
        list = list.filter((t) => !!t.auto && t.status !== "terminee");
        list = [...list].sort(sortByUrgency);
        break;
      case "done":
        list = list.filter((t) => t.status === "terminee" && t.completed_at && new Date(t.completed_at) >= weekAgo);
        break;
      case "archived":
        list = list.filter((t) => !!t.archived_at);
        break;
    }
    return list;
  }, [tasks, tab, quick, search, priorityFilter, statusFilter, poleFilter, dossierFilter, autoFilter, user?.id]);

  const fmtDue = (d: string | null) => d ? new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

  const renderCard = (t: Task, compact = false) => {
    const overdue = isOverdue(t.due_date, t.status);
    const tone = taskTone(t);
    const late = daysLate(t.due_date, t.status);
    return (
      <Card
        key={t.id}
        className={cn(
          "p-4 cursor-pointer hover:border-primary/40 transition",
          TONE_CARD_CLASSES[tone],
          compact ? "space-y-2" : "flex flex-wrap items-center gap-3",
        )}
        onClick={() => setDetailId(t.id)}
      >
        <div className="flex flex-wrap gap-1 flex-shrink-0">
          <PriorityBadge value={t.priority} />
          <StatusBadge value={t.status} />
          <OriginBadge auto={t.auto} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn("font-medium text-sm flex items-center gap-2", compact ? "line-clamp-2" : "truncate")}>
            {t.title}
            {overdue && <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />}
          </div>
          <div className={cn("text-xs text-muted-foreground", compact ? "" : "truncate")}>
            {t.assigned_to ? profilesMap[t.assigned_to] ?? "…" : "Non assigné"}
            {t.pole_id && <> · {polesMap[t.pole_id] ?? "…"}</>}
            {" · "}
            <span className={overdue ? "text-red-600 font-medium" : ""}>
              {fmtDue(t.due_date)}{late > 0 && ` (+${late} j)`}
            </span>
            {t.dossier_id && (
              <>
                {" · "}
                <a
                  href={`/dossiers/${t.dossier_id}`}
                  className="text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Voir dossier
                </a>
              </>
            )}
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl flex items-center gap-2">
            <ListChecks className="h-7 w-7 text-gold" /> Tâches agence
          </h1>
          <p className="text-muted-foreground mt-1">Gestion interne des tâches — priorités, échéances, assignations.</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <div className="flex rounded-md border overflow-hidden">
            <Button variant={view === "list" ? "secondary" : "ghost"} size="sm" className="rounded-none" onClick={() => setView("list")}>
              <ListIcon className="h-4 w-4 mr-1" /> Liste
            </Button>
            <Button variant={view === "kanban" ? "secondary" : "ghost"} size="sm" className="rounded-none" onClick={() => setView("kanban")}>
              <LayoutGrid className="h-4 w-4 mr-1" /> Kanban
            </Button>
          </div>
          {isStaff && (
            <Button className="flex-1 sm:flex-none" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Créer une tâche
            </Button>
          )}
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Input placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger><SelectValue placeholder="Priorité" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Toutes priorités</SelectItem>
              <SelectItem value="urgente">Urgente</SelectItem>
              <SelectItem value="haute">Haute</SelectItem>
              <SelectItem value="normale">Normale</SelectItem>
              <SelectItem value="basse">Basse</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue placeholder="Statut" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tous statuts</SelectItem>
              {STATUS_ORDER.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={poleFilter} onValueChange={setPoleFilter}>
            <SelectTrigger><SelectValue placeholder="Pôle" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tous pôles</SelectItem>
              {poles.map((p) => <SelectItem key={p.id} value={p.id}>{p.nom}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={dossierFilter} onValueChange={setDossierFilter}>
            <SelectTrigger><SelectValue placeholder="Dossier lié" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tous dossiers</SelectItem>
              {dossiersList.map((d) => <SelectItem key={d.id} value={d.id}>{d.titre}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={autoFilter} onValueChange={setAutoFilter}>
            <SelectTrigger><SelectValue placeholder="Origine" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Toutes origines</SelectItem>
              <SelectItem value="auto">Tâches automatiques</SelectItem>
              <SelectItem value="manual">Tâches manuelles</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2">
          {QUICK_FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={quick === f.value ? "default" : "outline"}
              onClick={() => setQuick(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-muted-foreground">
          {(["overdue", "today", "soon", "normal", "auto", "done", "archived"] as const).map((tone) => (
            <span key={tone} className="inline-flex items-center gap-1.5">
              <span className={cn("h-2.5 w-2.5 rounded-full", TONE_DOT_CLASSES[tone])} />
              {TONE_LABELS[tone]}
            </span>
          ))}
        </div>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="priority">Priorités ({counts.priority})</TabsTrigger>
          <TabsTrigger value="today">Aujourd'hui ({counts.today})</TabsTrigger>
          <TabsTrigger value="overdue">En retard ({counts.overdue})</TabsTrigger>
          <TabsTrigger value="mine">Mes tâches ({counts.mine})</TabsTrigger>
          <TabsTrigger value="team">Équipe ({counts.team})</TabsTrigger>
          <TabsTrigger value="auto">Automatiques ({counts.auto})</TabsTrigger>
          <TabsTrigger value="done">Terminées ({counts.done})</TabsTrigger>
          <TabsTrigger value="archived">Archivées ({counts.archived})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {view === "kanban" ? (
            <AgencyTasksKanbanBoard
              tasks={filtered}
              lanes={KANBAN_COLUMNS}
              canEdit={isStaff}
              profilesMap={profilesMap}
              polesMap={polesMap}
              onOpen={(id) => setDetailId(id)}
            />
          ) : filtered.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">Aucune tâche à afficher.</Card>
          ) : (
            <div className="space-y-2">{filtered.map((t) => renderCard(t))}</div>
          )}
        </TabsContent>
      </Tabs>

      <AgencyTaskFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <AgencyTaskDetailDialog taskId={detailId} open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)} />
    </div>
  );
}

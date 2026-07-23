import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, AlertTriangle, ListChecks } from "lucide-react";
import { PriorityBadge, StatusBadge, isOverdue, priorityRank } from "@/components/agency-task-badges";
import { AgencyTaskFormDialog } from "@/components/agency-task-form-dialog";
import { AgencyTaskDetailDialog } from "@/components/agency-task-detail-dialog";
import type { Database } from "@/integrations/supabase/types";

type Task = Database["public"]["Tables"]["agency_tasks"]["Row"];
type Priority = Database["public"]["Enums"]["agency_task_priority"];
type Status = Database["public"]["Enums"]["agency_task_status"];

export const Route = createFileRoute("/_authenticated/admin/taches-agence")({
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

function AgencyTasksPage() {
  const { user } = useAuth();
  const { isStaff } = useRole();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [tab, setTab] = useState("priority");
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [poleFilter, setPoleFilter] = useState<string>(ALL);
  const [dossierFilter, setDossierFilter] = useState<string>(ALL);
  const [autoFilter, setAutoFilter] = useState<string>(ALL);

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

  const includeArchived = tab === "archived";
  const { data: tasks = [] } = useQuery({
    queryKey: ["agency-tasks", "all", includeArchived],
    queryFn: async () => {
      let q = supabase.from("agency_tasks").select("*").order("due_date", { ascending: true, nullsFirst: false });
      if (!includeArchived) q = q.is("archived_at", null);
      const { data, error } = await q;
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

  const filtered = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date(); endOfDay.setHours(23,59,59,999);
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    let list = tasks;
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      list = list.filter((t) => t.title.toLowerCase().includes(s) || (t.description ?? "").toLowerCase().includes(s));
    }
    if (priorityFilter !== ALL) list = list.filter((t) => t.priority === priorityFilter);
    if (statusFilter !== ALL) list = list.filter((t) => t.status === statusFilter);
    if (poleFilter !== ALL) list = list.filter((t) => t.pole_id === poleFilter);
    if (dossierFilter !== ALL) list = list.filter((t) => (t as any).dossier_id === dossierFilter);
    if (autoFilter === "auto") list = list.filter((t) => !!(t as any).auto);
    else if (autoFilter === "manual") list = list.filter((t) => !(t as any).auto);

    switch (tab) {
      case "priority":
        list = list.filter((t) => t.status !== "terminee" && !t.archived_at);
        list = [...list].sort((a, b) => {
          const ao = isOverdue(a.due_date, a.status);
          const bo = isOverdue(b.due_date, b.status);
          const aScore = (a.priority === "urgente" && ao ? -1 : priorityRank(a.priority));
          const bScore = (b.priority === "urgente" && bo ? -1 : priorityRank(b.priority));
          if (aScore !== bScore) return aScore - bScore;
          if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
          if (a.due_date) return -1; if (b.due_date) return 1;
          return 0;
        });
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
      case "done":
        list = list.filter((t) => t.status === "terminee" && t.completed_at && new Date(t.completed_at) >= weekAgo);
        break;
      case "archived":
        list = list.filter((t) => !!t.archived_at);
        break;
    }
    return list;
  }, [tasks, tab, search, priorityFilter, statusFilter, poleFilter, dossierFilter, autoFilter, user?.id]);

  const fmtDue = (d: string | null) => d ? new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl flex items-center gap-2">
            <ListChecks className="h-7 w-7 text-gold" /> Tâches agence
          </h1>
          <p className="text-muted-foreground mt-1">Gestion interne des tâches — priorités, échéances, assignations.</p>
        </div>
        {isStaff && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Créer une tâche
          </Button>
        )}
      </div>

      <Card className="p-4">
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
              <SelectItem value="a_faire">À faire</SelectItem>
              <SelectItem value="en_cours">En cours</SelectItem>
              <SelectItem value="bloquee">Bloquée</SelectItem>
              <SelectItem value="terminee">Terminée</SelectItem>
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
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="priority">Priorités</TabsTrigger>
          <TabsTrigger value="today">Aujourd'hui</TabsTrigger>
          <TabsTrigger value="overdue">En retard</TabsTrigger>
          <TabsTrigger value="mine">Mes tâches</TabsTrigger>
          <TabsTrigger value="team">Équipe</TabsTrigger>
          <TabsTrigger value="done">Terminées</TabsTrigger>
          <TabsTrigger value="archived">Archivées</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {filtered.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">Aucune tâche à afficher.</Card>
          ) : (
            <div className="space-y-2">
              {filtered.map((t) => {
                const overdue = isOverdue(t.due_date, t.status);
                return (
                  <Card
                    key={t.id}
                    className="p-4 flex flex-wrap items-center gap-3 cursor-pointer hover:border-primary/40 transition"
                    onClick={() => setDetailId(t.id)}
                  >
                    <div className="flex gap-1 flex-shrink-0">
                      <PriorityBadge value={t.priority} />
                      <StatusBadge value={t.status} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate flex items-center gap-2">
                        {t.title}
                        {overdue && <AlertTriangle className="h-3.5 w-3.5 text-red-600" />}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {t.assigned_to ? profilesMap[t.assigned_to] ?? "…" : "Non assigné"}
                        {t.pole_id && <> · {polesMap[t.pole_id] ?? "…"}</>}
                        {" · "}
                        <span className={overdue ? "text-red-600 font-medium" : ""}>{fmtDue(t.due_date)}</span>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AgencyTaskFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <AgencyTaskDetailDialog taskId={detailId} open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)} />
    </div>
  );
}

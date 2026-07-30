import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search, FolderOpen, CheckCircle2, AlertTriangle, Circle, ClipboardCheck,
  LayoutGrid, List as ListIcon, Clock, FileText, MessageSquare, ListChecks, ArrowRight,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { categorieLabel, CATEGORIES } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { getExternalUnreadCounts } from "@/lib/qualiopi-notifications.functions";
import {
  computeDossierHealth, matchesQuickFilter, QUICK_FILTERS, TONE_STYLES,
  type DossierHealth, type QuickFilter,
} from "@/lib/dossier-health";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

type DocRow = {
  id: string;
  dossier_id: string;
  nom: string;
  detected_type: string | null;
  statut: string | null;
};

type TacheRow = { id: string; dossier_id: string; statut: string; cote_client: boolean | null };
type TaskRow = {
  id: string; dossier_id: string | null; title: string; status: string;
  priority: string | null; due_date: string | null; auto: boolean | null;
};

// Kanban lanes
const LANES: { key: string; label: string; statuts: string[] }[] = [
  { key: "todo", label: "À traiter", statuts: ["en_attente", "documents_manquants", "a_completer"] },
  { key: "doing", label: "En cours", statuts: ["en_cours_etude", "en_cours_traitement"] },
  { key: "done", label: "Terminés", statuts: ["termine", "valide"] },
  { key: "ko", label: "Refusés", statuts: ["refuse"] },
];
function laneOf(statut: string | null | undefined): string {
  return LANES.find((l) => l.statuts.includes(statut ?? ""))?.key ?? "todo";
}

export const Route = createFileRoute("/_authenticated/admin/dossiers")({
  head: () => ({ meta: [{ title: "Dossiers — Admin" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const ok = roles?.some((r) => ["admin","direction","manager","consultant"].includes(r.role));
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: AdminDossiers,
});

type ViewMode = "list" | "kanban";

function AdminDossiers() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [view, setView] = useState<ViewMode>("list");
  const [poleFilter, setPoleFilter] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);
  const { user } = useAuth();
  const { isDirectionOrAdmin } = useRole();

  const { data: myPoleIds, isLoading: polesLoading } = useQuery({
    queryKey: ["my-pole-ids", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pole_members").select("pole_id").eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.pole_id);
    },
  });

  const { data: allPoles = [] } = useQuery({
    queryKey: ["admin-dossiers-poles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("poles").select("id, code, nom, couleur, actif").eq("actif", true).order("nom");
      if (error) throw error;
      return data ?? [];
    },
  });

  const poles = isDirectionOrAdmin
    ? allPoles
    : allPoles.filter((p) => (myPoleIds ?? []).includes(p.id));

  const poleById = useMemo(() => {
    const m = new Map<string, any>();
    for (const p of poles) m.set(p.id, p);
    return m;
  }, [poles]);

  const { data: rows = [], isLoading: dossiersLoading, error: dossiersError } = useQuery({
    queryKey: ["admin-dossiers"],
    queryFn: async () => {
      const { data: dossiers, error } = await supabase
        .from("dossiers").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      const dossierRows = dossiers ?? [];
      const clientIds = [...new Set(dossierRows.map((d: any) => d.client_id).filter(Boolean))];
      if (clientIds.length === 0) return dossierRows;
      const { data: profiles } = await supabase
        .from("profiles").select("id, nom, prenom, email").in("id", clientIds);
      const profileById = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      return dossierRows.map((d: any) => ({ ...d, profiles: profileById.get(d.client_id) ?? null }));
    },
  });

  const dossierIds = useMemo(() => (rows as any[]).map((d) => d.id), [rows]);

  const { data: docsByDossier = {} } = useQuery({
    queryKey: ["admin-dossiers-docs", dossierIds.join(",")],
    enabled: dossierIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents").select("id, dossier_id, nom, detected_type, statut").in("dossier_id", dossierIds);
      if (error) throw error;
      const m: Record<string, DocRow[]> = {};
      for (const d of (data ?? []) as DocRow[]) (m[d.dossier_id] ??= []).push(d);
      return m;
    },
  });

  const { data: tachesByDossier = {} } = useQuery({
    queryKey: ["admin-dossiers-taches", dossierIds.join(",")],
    enabled: dossierIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("taches").select("id, dossier_id, statut, cote_client").in("dossier_id", dossierIds);
      if (error) throw error;
      const m: Record<string, TacheRow[]> = {};
      for (const t of (data ?? []) as TacheRow[]) (m[t.dossier_id] ??= []).push(t);
      return m;
    },
  });

  const { data: taskByDossier = {} } = useQuery({
    queryKey: ["admin-dossiers-linked-tasks", dossierIds.join(",")],
    enabled: dossierIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agency_tasks")
        .select("id, dossier_id, title, status, priority, due_date, auto")
        .in("dossier_id", dossierIds)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const m: Record<string, TaskRow> = {};
      for (const t of (data ?? []) as TaskRow[]) {
        if (t.dossier_id && !m[t.dossier_id]) m[t.dossier_id] = t;
      }
      return m;
    },
  });

  const unreadFn = useServerFn(getExternalUnreadCounts);
  const { data: externalUnread = {} } = useQuery({
    queryKey: ["admin-dossiers-external-unread"],
    queryFn: () => unreadFn(),
    refetchInterval: 30_000,
  });

  const healthById = useMemo(() => {
    const m: Record<string, DossierHealth> = {};
    for (const d of rows as any[]) {
      m[d.id] = computeDossierHealth({
        dossier: d,
        documents: (docsByDossier as any)[d.id] ?? [],
        taches: (tachesByDossier as any)[d.id] ?? [],
        linkedTask: (taskByDossier as any)[d.id] ?? null,
      });
    }
    return m;
  }, [rows, docsByDossier, tachesByDossier, taskByDossier]);

  const filtered = (rows as any[]).filter((r: any) => {
    const isArchived = !!r.archived_at;
    if (showArchived ? !isArchived : isArchived) return false;
    if (cat !== "all" && r.categorie !== cat) return false;
    if (poleFilter !== "all" && r.pole_id !== poleFilter) return false;
    const h = healthById[r.id];
    if (h && !matchesQuickFilter(quick, h, !!(taskByDossier as any)[r.id])) return false;
    if (!q.trim()) return true;
    const txt = `${r.titre} ${r.organisme_nom ?? ""} ${r.profiles?.email ?? ""} ${r.profiles?.nom ?? ""} ${r.profiles?.prenom ?? ""}`.toLowerCase();
    return txt.includes(q.toLowerCase());
  });

  const archivedCount = (rows as any[]).filter((r: any) => !!r.archived_at).length;

  const groups: { pole: any; items: any[] }[] = poles.map((p) => ({
    pole: p, items: filtered.filter((d: any) => d.pole_id === p.id),
  }));
  if (isDirectionOrAdmin) {
    const orphelins = filtered.filter((d: any) => !poles.some((p) => p.id === d.pole_id));
    if (orphelins.length > 0) {
      groups.push({ pole: { id: "_orphelins", nom: "Sans pôle actif", couleur: "#94a3b8" }, items: orphelins });
    }
  }
  const visibleGroups = groups.filter((g) => g.items.length > 0);

  const activeRows = (rows as any[]).filter((d) => !d.archived_at);
  const totalToReview = activeRows.reduce((n, d) => n + (healthById[d.id]?.docs.needsAction ? 1 : 0), 0);
  const totalAnomalies = activeRows.reduce((n, d) => n + ((healthById[d.id]?.anomalies.length ?? 0) > 0 ? 1 : 0), 0);

  const filterCount = (f: QuickFilter) =>
    activeRows.filter((d) => healthById[d.id] &&
      matchesQuickFilter(f, healthById[d.id], !!(taskByDossier as any)[d.id])).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">
            {isDirectionOrAdmin ? "Tous les dossiers" : "Dossiers de mes pôles"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {filtered.length} dossier{filtered.length > 1 ? "s" : ""} · {visibleGroups.length} pôle{visibleGroups.length > 1 ? "s" : ""}
            {totalToReview > 0 && (
              <> · <span className="text-warning-foreground font-medium">{totalToReview} à revoir</span></>
            )}
            {totalAnomalies > 0 && (
              <> · <span className="text-purple-600 dark:text-purple-400 font-medium">{totalAnomalies} avec alerte</span></>
            )}
          </p>
        </div>
        <div className="inline-flex rounded-md border border-input overflow-hidden">
          <button
            type="button"
            onClick={() => setView("list")}
            className={cn("h-9 px-3 inline-flex items-center gap-2 text-sm",
              view === "list" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted/50")}
            aria-pressed={view === "list"}
          >
            <ListIcon className="h-4 w-4" /> Liste
          </button>
          <button
            type="button"
            onClick={() => setView("kanban")}
            className={cn("h-9 px-3 inline-flex items-center gap-2 text-sm border-l border-input",
              view === "kanban" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted/50")}
            aria-pressed={view === "kanban"}
          >
            <LayoutGrid className="h-4 w-4" /> Kanban
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-64">
          <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
          <Input className="pl-9" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select value={poleFilter} onChange={(e) => setPoleFilter(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">Tous les pôles</option>
          {poles.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
        </select>
        <select value={cat} onChange={(e) => setCat(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">Toutes catégories</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className={cn("h-10 px-3 rounded-md border text-sm inline-flex items-center gap-2 transition-colors",
            showArchived ? "bg-primary text-primary-foreground border-primary"
                         : "bg-background border-input hover:bg-muted/50")}
          aria-pressed={showArchived}
          title="Les dossiers terminés sont archivés automatiquement"
        >
          <FolderOpen className="h-4 w-4" />
          {showArchived ? "Archives" : `Archives${archivedCount > 0 ? ` (${archivedCount})` : ""}`}
        </button>
      </div>

      {/* Filtres rapides */}
      <div className="flex flex-wrap gap-2">
        {QUICK_FILTERS.map((f) => {
          const n = f.key === "all" ? activeRows.length : filterCount(f.key);
          const active = quick === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setQuick(f.key)}
              aria-pressed={active}
              className={cn(
                "h-8 px-3 rounded-full border text-xs inline-flex items-center gap-1.5 transition-colors",
                active ? "bg-primary text-primary-foreground border-primary"
                       : "bg-background border-input hover:bg-muted/50",
              )}
            >
              {f.key === "to_review_all" && <ClipboardCheck className="h-3 w-3" />}
              {f.label}
              <span className={cn("tabular-nums", active ? "opacity-90" : "text-muted-foreground")}>{n}</span>
            </button>
          );
        })}
      </div>

      {dossiersError ? (
        <Card className="p-8 text-center border-destructive/30 bg-destructive/5">
          <AlertTriangle className="h-6 w-6 mx-auto text-destructive mb-2" />
          <div className="font-medium text-sm">Impossible de charger les dossiers.</div>
          <div className="text-xs text-muted-foreground mt-1">{(dossiersError as any)?.message ?? "Erreur inconnue"}</div>
        </Card>
      ) : dossiersLoading || (polesLoading && !isDirectionOrAdmin) ? (
        <Card className="p-12 text-center text-muted-foreground text-sm">Chargement des dossiers…</Card>
      ) : (rows as any[]).length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <FolderOpen className="h-8 w-8 mx-auto text-muted-foreground" />
          <div className="font-display text-lg">Aucun dossier créé pour le moment</div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {isDirectionOrAdmin
              ? "La plateforme ne contient encore aucun dossier client."
              : "Aucun dossier n'a encore été créé dans vos pôles."}
          </p>
        </Card>
      ) : visibleGroups.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground text-sm">
          Aucun dossier ne correspond à ces filtres.
        </Card>
      ) : view === "kanban" ? (
        <KanbanView
          items={filtered}
          healthById={healthById}
          taskByDossier={taskByDossier as Record<string, TaskRow>}
          poleById={poleById}
          externalUnread={externalUnread as Record<string, number>}
        />
      ) : (
        <div className="space-y-6">
          {visibleGroups.map(({ pole, items }) => {
            const groupToReview = items.reduce((n: number, d: any) => n + (healthById[d.id]?.docs.needsAction ? 1 : 0), 0);
            const color = pole.couleur ?? "#94a3b8";
            return (
              <section key={pole.id} className="space-y-2">
                <div className="flex items-center gap-2 px-1 flex-wrap">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                  <h2 className="font-display text-lg">{pole.nom}</h2>
                  <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-muted text-xs font-medium text-muted-foreground">
                    {items.length}
                  </span>
                  {groupToReview > 0 && (
                    <Badge variant="outline" className="bg-warning/15 border-warning/30 text-warning-foreground text-xs">
                      {groupToReview} à revoir
                    </Badge>
                  )}
                </div>
                <Card className="divide-y overflow-hidden">
                  {items.map((d: any) => (
                    <DossierRow
                      key={d.id}
                      d={d}
                      health={healthById[d.id]}
                      task={(taskByDossier as any)[d.id] ?? null}
                      poleName={pole.nom}
                      poleColor={color}
                      unread={(externalUnread as Record<string, number>)[d.id] ?? 0}
                    />
                  ))}
                </Card>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HealthBadges({ health, task, compact = false }: {
  health: DossierHealth | undefined; task: TaskRow | null; compact?: boolean;
}) {
  if (!health) return null;
  const size = compact ? "text-[10px] py-0 h-5" : "text-xs";
  const { docs } = health;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {docs.total > 0 && (
        <Badge variant="outline" className={cn(size, "gap-1",
          docs.validated === docs.total ? "bg-success/15 text-success border-success/25" : "bg-muted text-muted-foreground")}>
          {docs.validated === docs.total ? <CheckCircle2 className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
          {docs.validated}/{docs.total} validés
        </Badge>
      )}
      {docs.toReview > 0 && (
        <Badge variant="outline" className={cn(size, "gap-1", TONE_STYLES.orange.badge)}>
          <Circle className="h-3 w-3" /> {docs.toReview} à vérifier
        </Badge>
      )}
      {docs.toFix > 0 && (
        <Badge variant="outline" className={cn(size, "gap-1", TONE_STYLES.red.badge)}>
          <AlertTriangle className="h-3 w-3" /> {docs.toFix} à corriger
        </Badge>
      )}
      {docs.missing > 0 && (
        <Badge variant="outline" className={cn(size, TONE_STYLES.yellow.badge)}>
          {docs.missing} manquant{docs.missing > 1 ? "s" : ""}
        </Badge>
      )}
      {health.steps.total > 0 && (
        <Badge variant="outline" className={cn(size, "gap-1 bg-muted text-muted-foreground")}>
          <ListChecks className="h-3 w-3" /> Étapes {health.steps.done}/{health.steps.total}
        </Badge>
      )}
      {task && (
        <Badge variant="outline" className={cn(size, "gap-1",
          health.taskOverdue ? TONE_STYLES.red.badge : "bg-muted text-muted-foreground")}>
          {task.auto ? "Tâche auto" : "Tâche"}{health.taskOverdue ? " en retard" : ""}
        </Badge>
      )}
      {health.blocked && (
        <Badge variant="outline" className={cn(size, "gap-1", TONE_STYLES.red.badge)}>
          <Clock className="h-3 w-3" /> Bloqué {health.inactiveDays}j
        </Badge>
      )}
      {health.anomalies.map((a) => (
        <Badge key={a.key} variant="outline" className={cn(size, "gap-1",
          a.severity === "critical" ? TONE_STYLES.red.badge : TONE_STYLES.purple.badge)} title={a.detail}>
          <AlertTriangle className="h-3 w-3" /> {a.label}
        </Badge>
      ))}
    </div>
  );
}

function DossierRow({ d, health, task, poleName, poleColor, unread = 0 }: {
  d: any; health: DossierHealth | undefined; task: TaskRow | null;
  poleName: string; poleColor: string; unread?: number;
}) {
  const tone = TONE_STYLES[health?.tone ?? "blue"];
  return (
    <Link
      to={`/dossiers/${d.id}${unread > 0 ? "#audit-chat" : ""}`}
      className={cn("block p-4 relative transition-colors hover:bg-muted/40", tone.card)}
      title={health?.nextAction}
    >
      <span className={cn("absolute left-0 top-0 bottom-0 w-1", tone.bar)} aria-hidden />
      <div className="pl-2 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider border"
            style={{
              color: poleColor,
              borderColor: `color-mix(in oklab, ${poleColor} 35%, transparent)`,
              backgroundColor: `color-mix(in oklab, ${poleColor} 12%, transparent)`,
            }}
          >
            {poleName}
          </span>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            {categorieLabel(d.categorie)}
          </Badge>
          <StatusBadge statut={d.statut} />
          {unread > 0 && (
            <Badge className="bg-primary text-primary-foreground text-xs gap-1">
              <MessageSquare className="h-3 w-3" /> {unread} audit
            </Badge>
          )}
        </div>

        <div className="font-medium truncate">{d.titre}</div>
        <div className="text-xs text-muted-foreground">
          {d.organisme_nom ? <>{d.organisme_nom} · </> : null}
          {d.profiles?.prenom} {d.profiles?.nom} · {d.profiles?.email}
        </div>

        <HealthBadges health={health} task={task} />

        <div className="flex items-center gap-2 pt-1">
          <div className="h-1.5 flex-1 max-w-40 rounded-full bg-muted overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", tone.bar)}
              style={{ width: `${health?.global ?? 0}%` }} />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{health?.global ?? 0}% global</span>
          {health && health.manual !== health.global && (
            <span className="text-[11px] text-muted-foreground">(manuel {health.manual}%)</span>
          )}
          <span className="text-[11px] text-muted-foreground ml-auto hidden sm:inline">
            {d.updated_at ? formatDistanceToNow(new Date(d.updated_at), { addSuffix: true, locale: fr }) : ""}
          </span>
        </div>

        {health && (
          <div className="text-xs flex items-center gap-1 text-muted-foreground">
            <ArrowRight className="h-3 w-3 shrink-0" />
            <span className="truncate">{health.nextAction}</span>
          </div>
        )}
      </div>
    </Link>
  );
}

function KanbanView({ items, healthById, taskByDossier, poleById, externalUnread = {} }: {
  items: any[];
  healthById: Record<string, DossierHealth>;
  taskByDossier: Record<string, TaskRow>;
  poleById: Map<string, any>;
  externalUnread?: Record<string, number>;
}) {
  const byLane = useMemo(() => {
    const m: Record<string, any[]> = { todo: [], doing: [], done: [], ko: [] };
    for (const d of items) m[laneOf(d.statut)].push(d);
    return m;
  }, [items]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {LANES.map((lane) => {
        const list = byLane[lane.key] ?? [];
        return (
          <div key={lane.key} className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="font-display text-sm uppercase tracking-wider text-muted-foreground">{lane.label}</h3>
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-muted text-xs font-medium">
                {list.length}
              </span>
            </div>
            <div className="space-y-2 min-h-24">
              {list.length === 0 ? (
                <Card className="p-4 border-dashed text-center text-xs text-muted-foreground">Vide</Card>
              ) : list.map((d: any) => {
                const pole = poleById.get(d.pole_id);
                const color = pole?.couleur ?? "#94a3b8";
                const health = healthById[d.id];
                const tone = TONE_STYLES[health?.tone ?? "blue"];
                const unread = externalUnread[d.id] ?? 0;
                return (
                  <Link key={d.id}
                    to={`/dossiers/${d.id}${unread > 0 ? "#audit-chat" : ""}`}
                    title={health?.nextAction}
                    className={cn(
                      "block relative rounded-lg border hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden",
                      tone.card,
                    )}>
                    <span className={cn("absolute left-0 top-0 bottom-0 w-1", tone.bar)} aria-hidden />
                    <div className="p-3 pl-4 space-y-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border"
                          style={{
                            color,
                            borderColor: `color-mix(in oklab, ${color} 35%, transparent)`,
                            backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
                          }}
                        >
                          {pole?.nom ?? "Sans pôle"}
                        </span>
                        {unread > 0 && (
                          <Badge className="bg-primary text-primary-foreground text-[10px] py-0 h-5 gap-1">
                            <MessageSquare className="h-2.5 w-2.5" /> {unread}
                          </Badge>
                        )}
                      </div>
                      <div className="font-medium text-sm line-clamp-2">{d.titre}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {d.organisme_nom ?? `${d.profiles?.prenom ?? ""} ${d.profiles?.nom ?? ""}`}
                      </div>
                      <HealthBadges health={health} task={taskByDossier[d.id] ?? null} compact />
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                          <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${health?.global ?? 0}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground tabular-nums">{health?.global ?? 0}%</span>
                      </div>
                      {health && (
                        <div className="text-[11px] text-muted-foreground line-clamp-1">→ {health.nextAction}</div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

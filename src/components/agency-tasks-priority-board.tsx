import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, AlertTriangle, Bot } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  PriorityBadge, StatusBadge, OriginBadge, isOverdue, daysLate, sortByUrgency,
  taskTone, TONE_CARD_CLASSES,
} from "./agency-task-badges";
import { AgencyTaskFormDialog } from "./agency-task-form-dialog";
import { AgencyTaskDetailDialog } from "./agency-task-detail-dialog";
import { cn } from "@/lib/utils";
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

  const { overdue, today, autos } = useMemo(() => {
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const sorted = [...tasks].sort(sortByUrgency);
    const overdue = sorted.filter((t) => isOverdue(t.due_date, t.status) && !t.auto).slice(0, 6);
    const today = sorted
      .filter((t) => !t.auto && t.due_date && new Date(t.due_date) >= startOfDay && new Date(t.due_date) <= endOfDay)
      .slice(0, 6);
    const autos = sorted.filter((t) => !!t.auto).slice(0, 6);
    return { overdue, today, autos };
  }, [tasks]);

  const fmtDue = (d: string | null) => d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—";

  const Row = ({ t }: { t: Task }) => {
    const od = isOverdue(t.due_date, t.status);
    const late = daysLate(t.due_date, t.status);
    const tone = taskTone(t);
    return (
      <button
        onClick={() => setDetailId(t.id)}
        className={cn(
          "w-full p-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 text-left rounded-md hover:brightness-95 transition border",
          TONE_CARD_CLASSES[tone],
        )}
      >
        <div className="flex-shrink-0 flex flex-wrap gap-1 pt-0.5">
          <PriorityBadge value={t.priority} />
          {t.auto && <OriginBadge auto />}
        </div>
        <div className="min-w-0">
          <div className="font-medium text-sm flex items-start gap-2">
            <span className="line-clamp-2 break-words">{t.title}</span>
            {od && <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />}
          </div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {t.assigned_to ? profilesMap[t.assigned_to] ?? "…" : "Non assigné"}
            {" · "}
            <span className={od ? "text-red-600 font-medium" : ""}>
              {t.due_date ? (od ? `En retard de ${late} j — ` : "Échéance : ") : "Aucune échéance"}
              {t.due_date ? fmtDue(t.due_date) : ""}
            </span>
          </div>
        </div>
        <div className="shrink-0"><StatusBadge value={t.status} /></div>
      </button>
    );
  };

  const Section = ({ title, icon, items, empty }: { title: string; icon?: React.ReactNode; items: Task[]; empty: string }) => (
    <div className="space-y-2">
      <div className="text-sm font-medium flex items-center gap-2">{icon}{title} <span className="text-xs text-muted-foreground">({items.length})</span></div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">{empty}</div>
      ) : (
        <div className="space-y-2">{items.map((t) => <Row key={t.id} t={t} />)}</div>
      )}
    </div>
  );

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

      <div className="space-y-5">
        <Section title="Tâches manuelles en retard" icon={<AlertTriangle className="h-4 w-4 text-red-600" />} items={overdue} empty="Aucune tâche en retard." />
        <Section title="Tâches manuelles du jour" items={today} empty="Aucune échéance aujourd'hui." />
        <Section title="Tâches automatiques" icon={<Bot className="h-4 w-4 text-violet-600" />} items={autos} empty="Aucune tâche automatique en cours." />
        <DossierSignals />
      </div>


      <AgencyTaskFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <AgencyTaskDetailDialog taskId={detailId} open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)} />
    </Card>
  );
}

/** Signaux dossiers : bloqués et documents à vérifier. */
function DossierSignals() {
  const { data } = useQuery({
    queryKey: ["priority-board-dossier-signals"],
    queryFn: async () => {
      const { data: dossiers } = await supabase
        .from("dossiers")
        .select("id, titre, categorie, statut, avancement, updated_at, archived_at, organisme_nom")
        .is("archived_at", null)
        .order("updated_at", { ascending: true })
        .limit(200);
      const list = dossiers ?? [];
      const ids = list.map((d) => d.id);
      if (!ids.length) return { blocked: [], toReview: [] };
      const [docsRes, tachesRes] = await Promise.all([
        supabase.from("documents").select("id, dossier_id, nom, detected_type, statut").in("dossier_id", ids),
        supabase.from("taches").select("id, dossier_id, statut").in("dossier_id", ids),
      ]);
      const docsBy: Record<string, any[]> = {};
      for (const d of docsRes.data ?? []) (docsBy[d.dossier_id] ??= []).push(d);
      const tachesBy: Record<string, any[]> = {};
      for (const t of tachesRes.data ?? []) (tachesBy[t.dossier_id] ??= []).push(t);

      const blocked: any[] = [];
      const toReview: any[] = [];
      for (const d of list) {
        const h = computeDossierHealth({
          dossier: d as any,
          documents: docsBy[d.id] ?? [],
          taches: tachesBy[d.id] ?? [],
        });
        if (h.blocked) blocked.push({ ...d, h });
        if (h.docs.toReview > 0) toReview.push({ ...d, h });
      }
      return { blocked: blocked.slice(0, 6), toReview: toReview.slice(0, 6) };
    },
  });

  const renderList = (items: any[], empty: string) =>
    items.length === 0 ? (
      <div className="text-xs text-muted-foreground py-2">{empty}</div>
    ) : (
      <div className="space-y-2">
        {items.map((d) => {
          const tone = TONE_STYLES[d.h.tone as keyof typeof TONE_STYLES];
          return (
            <Link key={d.id} to="/dossiers/$id" params={{ id: d.id }}
              className={cn("block relative overflow-hidden rounded-md border p-2.5 pl-4 text-sm hover:shadow-sm transition", tone.card)}>
              <span className={cn("absolute left-0 top-0 bottom-0 w-1", tone.bar)} aria-hidden />
              <div className="font-medium truncate">{d.titre}</div>
              <div className="text-xs text-muted-foreground truncate">
                {d.organisme_nom ? `${d.organisme_nom} · ` : ""}{d.h.global}% · {d.h.nextAction}
              </div>
            </Link>
          );
        })}
      </div>
    );

  return (
    <>
      <div>
        <div className="flex items-center gap-2 mb-2">
          <FolderOpen className="h-4 w-4 text-red-600" />
          <h3 className="text-sm font-semibold">Dossiers bloqués</h3>
        </div>
        {renderList(data?.blocked ?? [], "Aucun dossier bloqué.")}
      </div>
      <div>
        <div className="flex items-center gap-2 mb-2">
          <FileSearch className="h-4 w-4 text-orange-500" />
          <h3 className="text-sm font-semibold">Documents à vérifier</h3>
        </div>
        {renderList(data?.toReview ?? [], "Aucun document en attente de vérification.")}
      </div>
    </>
  );
}

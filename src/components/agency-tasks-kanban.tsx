import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor, useDroppable,
  useSensor, useSensors, closestCorners, type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { AlertTriangle, GripVertical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  PriorityBadge, StatusBadge, OriginBadge, isOverdue, daysLate, taskTone, TONE_CARD_CLASSES,
} from "@/components/agency-task-badges";
import type { Database } from "@/integrations/supabase/types";

type Task = Database["public"]["Tables"]["agency_tasks"]["Row"];
type Status = Database["public"]["Enums"]["agency_task_status"];

export type TaskLane = { status: Status; label: string };

const ORDER_KEY = "izisuivis:kanban-taches-order";
function loadOrder(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) ?? "{}"); } catch { return {}; }
}
function saveOrder(o: Record<string, string[]>) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(o)); } catch { /* ignore */ }
}

const fmtDue = (d: string | null) =>
  d ? new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

type CardProps = {
  t: Task;
  profilesMap: Record<string, string>;
  polesMap: Record<string, string>;
};

function TaskCardContent({ t, profilesMap, polesMap, dragging, handleProps }: CardProps & {
  dragging?: boolean;
  handleProps?: Record<string, any>;
}) {
  const overdue = isOverdue(t.due_date, t.status);
  const late = daysLate(t.due_date, t.status);
  const tone = taskTone(t);
  return (
    <Card
      className={cn(
        "p-3 space-y-2 transition-shadow",
        TONE_CARD_CLASSES[tone],
        dragging ? "shadow-xl ring-2 ring-primary/40" : "hover:shadow-md",
      )}
    >
      <div className="flex items-start gap-1.5">
        <div className="flex flex-wrap gap-1 min-w-0 flex-1">
          <PriorityBadge value={t.priority} />
          <StatusBadge value={t.status} />
          <OriginBadge auto={t.auto} />
        </div>
        {handleProps && (
          <button
            type="button"
            aria-label="Déplacer la tâche"
            className="shrink-0 -mr-1 -mt-1 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-grab active:cursor-grabbing touch-none"
            {...handleProps}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="font-medium text-sm flex items-start gap-2">
        <span className="line-clamp-2 break-words">{t.title}</span>
        {overdue && <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />}
      </div>
      <div className="text-xs text-muted-foreground">
        {t.assigned_to ? profilesMap[t.assigned_to] ?? "…" : "Non assigné"}
        {t.pole_id && <> · {polesMap[t.pole_id] ?? "…"}</>}
        {" · "}
        <span className={overdue ? "text-red-600 font-medium" : ""}>
          {fmtDue(t.due_date)}{late > 0 && ` (+${late} j)`}
        </span>
      </div>
    </Card>
  );
}

function SortableTaskCard(props: CardProps & { canDrag: boolean; onOpen: (id: string) => void }) {
  const { t, canDrag, onOpen } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: t.id,
    disabled: !canDrag,
    data: { type: "card" },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("cursor-pointer", isDragging && "opacity-40")}
      onClick={() => onOpen(t.id)}
    >
      <TaskCardContent
        {...props}
        handleProps={canDrag ? { ...attributes, ...listeners, onClick: (e: any) => e.stopPropagation() } : undefined}
      />
    </div>
  );
}

function TaskColumn({ lane, ids, children, isOver }: {
  lane: TaskLane; ids: string[]; children: React.ReactNode; isOver: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: `lane:${lane.status}`, data: { type: "lane" } });
  return (
    <div className="rounded-lg border bg-muted/30 p-2 space-y-2 min-w-0">
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-sm font-medium">{lane.label}</span>
        <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-muted text-xs font-medium">
          {ids.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "space-y-2 min-h-24 rounded-lg p-1 transition-colors border border-transparent",
          isOver && "bg-primary/5 border-primary/30 border-dashed",
        )}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
        {ids.length === 0 && (
          <Card className="p-4 border-dashed text-center text-xs text-muted-foreground">Déposez une tâche ici</Card>
        )}
      </div>
    </div>
  );
}

export function AgencyTasksKanbanBoard({
  tasks, lanes, canEdit, profilesMap, polesMap, onOpen,
}: {
  tasks: Task[];
  lanes: TaskLane[];
  canEdit: boolean;
  profilesMap: Record<string, string>;
  polesMap: Record<string, string>;
  onOpen: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [order, setOrder] = useState<Record<string, string[]>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<string | null>(null);
  const [statusOverride, setStatusOverride] = useState<Record<string, string>>({});

  useEffect(() => { setOrder(loadOrder()); }, []);

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const columns = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const l of lanes) m[l.status] = [];
    for (const t of tasks) {
      const key = statusOverride[t.id] ?? t.status;
      (m[key] ?? (m[lanes[0].status] as Task[])).push(t);
    }
    for (const l of lanes) {
      const saved = order[l.status] ?? [];
      m[l.status].sort((a, b) => {
        const ia = saved.indexOf(a.id), ib = saved.indexOf(b.id);
        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
    }
    return m;
  }, [tasks, lanes, order, statusOverride]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function findLaneOfId(id: string): string | null {
    for (const l of lanes) if ((columns[l.status] ?? []).some((t) => t.id === id)) return l.status;
    return null;
  }

  function handleDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)); }

  function handleDragOver(e: DragOverEvent) {
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) { setOverLane(null); return; }
    setOverLane(overId.startsWith("lane:") ? overId.slice(5) : findLaneOfId(overId));
  }

  async function handleDragEnd(e: DragEndEvent) {
    const activeCardId = String(e.active.id);
    setActiveId(null);
    setOverLane(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;

    const sourceLane = findLaneOfId(activeCardId);
    const targetLane = overId.startsWith("lane:") ? overId.slice(5) : findLaneOfId(overId);
    if (!sourceLane || !targetLane) return;

    if (!canEdit) {
      toast.error("Vous n'avez pas les droits pour déplacer cette tâche.");
      return;
    }

    if (sourceLane === targetLane) {
      const list = columns[sourceLane].map((t) => t.id);
      const from = list.indexOf(activeCardId);
      const to = overId.startsWith("lane:") ? list.length - 1 : list.indexOf(overId);
      if (from === -1 || to === -1 || from === to) return;
      const next = { ...order, [sourceLane]: arrayMove(list, from, to) };
      setOrder(next);
      saveOrder(next);
      return;
    }

    const targetIds = columns[targetLane].map((t) => t.id);
    const insertAt = overId.startsWith("lane:") ? targetIds.length : Math.max(0, targetIds.indexOf(overId));
    const nextOrder = {
      ...order,
      [sourceLane]: columns[sourceLane].map((t) => t.id).filter((id) => id !== activeCardId),
      [targetLane]: [...targetIds.slice(0, insertAt), activeCardId, ...targetIds.slice(insertAt)],
    };
    setOrder(nextOrder);
    saveOrder(nextOrder);
    setStatusOverride((o) => ({ ...o, [activeCardId]: targetLane }));

    const patch: Record<string, any> = { status: targetLane };
    patch.completed_at = targetLane === "terminee" ? new Date().toISOString() : null;

    const { error } = await supabase.from("agency_tasks").update(patch).eq("id", activeCardId);

    const clear = () => setStatusOverride((o) => { const n = { ...o }; delete n[activeCardId]; return n; });

    if (error) {
      clear();
      toast.error("Déplacement impossible", { description: error.message });
      return;
    }

    toast.success(`Tâche déplacée vers « ${lanes.find((l) => l.status === targetLane)?.label} »`);
    await queryClient.invalidateQueries({ queryKey: ["agency-tasks"] });
    clear();
  }

  const activeTask = activeId ? byId.get(activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { setActiveId(null); setOverLane(null); }}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        {lanes.map((lane) => {
          const list = columns[lane.status] ?? [];
          return (
            <TaskColumn key={lane.status} lane={lane} ids={list.map((t) => t.id)} isOver={overLane === lane.status}>
              {list.map((t) => (
                <SortableTaskCard
                  key={t.id}
                  t={t}
                  canDrag={canEdit}
                  profilesMap={profilesMap}
                  polesMap={polesMap}
                  onOpen={onOpen}
                />
              ))}
            </TaskColumn>
          );
        })}
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
        {activeTask ? (
          <div className="rotate-2 opacity-95 w-[280px] max-w-[85vw]">
            <TaskCardContent t={activeTask} dragging profilesMap={profilesMap} polesMap={polesMap} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

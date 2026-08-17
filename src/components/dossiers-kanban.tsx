import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCorners, type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, FileText, MessageSquare, GripVertical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export type KanbanLane = { key: string; label: string; statuts: string[] };

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  return Math.floor((Date.now() - d) / 86400000);
}

const ORDER_KEY = "izisuivis:kanban-dossiers-order";
function loadOrder(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) ?? "{}"); } catch { return {}; }
}
function saveOrder(o: Record<string, string[]>) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(o)); } catch { /* ignore */ }
}

type CardProps = {
  d: any;
  poleById: Map<string, any>;
  statsById: Record<string, any>;
  inconsistencyById: Record<string, any>;
  externalUnread: Record<string, number>;
};

function CardContent({ d, poleById, statsById, inconsistencyById, externalUnread, dragging, handleProps }: CardProps & {
  dragging?: boolean;
  handleProps?: Record<string, any>;
}) {
  const pole = poleById.get(d.pole_id);
  const color = pole?.couleur ?? "#94a3b8";
  const stats = statsById[d.id];
  const inc = inconsistencyById[d.id];
  const days = daysSince(d.updated_at);
  const inactive = days !== null && days >= 7 && !["termine", "valide", "refuse"].includes(d.statut);
  const unread = externalUnread[d.id] ?? 0;

  return (
    <div
      className={cn(
        "relative rounded-lg border overflow-hidden transition-shadow",
        dragging ? "shadow-xl ring-2 ring-primary/40" : "hover:shadow-md",
      )}
      style={{
        backgroundColor: `color-mix(in oklab, ${color} 5%, var(--card))`,
        borderColor: `color-mix(in oklab, ${color} 25%, var(--border))`,
      }}
    >
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: color }} aria-hidden />
      <div className="p-3 pl-4 space-y-2">
        <div className="flex items-start gap-1.5">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
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
          {handleProps && (
            <button
              type="button"
              aria-label="Déplacer le dossier"
              className="shrink-0 -mr-1 -mt-1 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-grab active:cursor-grabbing touch-none"
              {...handleProps}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="font-medium text-sm line-clamp-2">{d.titre}</div>
        <div className="text-xs text-muted-foreground truncate">
          {d.profiles?.prenom} {d.profiles?.nom}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {stats && stats.total > 0 && (
            <Badge variant="outline" className="text-[10px] gap-1 py-0 h-5">
              <FileText className="h-2.5 w-2.5" /> {stats.validated}/{stats.total}
            </Badge>
          )}
          {stats?.toFix ? (
            <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30 text-[10px] py-0 h-5">
              {stats.toFix} à corriger
            </Badge>
          ) : null}
          {stats?.missing ? (
            <Badge variant="outline" className="bg-warning/15 text-warning-foreground border-warning/30 text-[10px] py-0 h-5">
              {stats.missing} manquant{stats.missing > 1 ? "s" : ""}
            </Badge>
          ) : null}
          {inactive && (
            <Badge variant="outline" className="bg-warning/15 text-warning-foreground border-warning/30 text-[10px] py-0 h-5 gap-1">
              <Clock className="h-2.5 w-2.5" /> {days}j
            </Badge>
          )}
          {(inc === "done_incomplete" || inc === "zero_but_validated") && (
            <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30 text-[10px] py-0 h-5 gap-1">
              <AlertTriangle className="h-2.5 w-2.5" /> Alerte
            </Badge>
          )}
        </div>
      </div>

    </div>
  );
}

function SortableCard(props: CardProps & { canDrag: boolean; onOpen: (id: string, unread: number) => void }) {
  const { d, canDrag, onOpen, externalUnread } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: d.id,
    disabled: !canDrag,
    data: { type: "card", dossier: d },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("cursor-pointer", isDragging && "opacity-40")}
      onClick={() => onOpen(d.id, externalUnread[d.id] ?? 0)}
    >
      <CardContent {...props} handleProps={canDrag ? { ...attributes, ...listeners, onClick: (e: any) => e.stopPropagation() } : undefined} />
    </div>
  );
}

function KanbanColumn({ lane, ids, children, isOver }: {
  lane: KanbanLane; ids: string[]; children: React.ReactNode; isOver: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: `lane:${lane.key}`, data: { type: "lane", laneKey: lane.key } });
  return (
    <div className="space-y-2 min-w-0">
      <div className="flex items-center justify-between px-1">
        <h3 className="font-display text-sm uppercase tracking-wider text-muted-foreground">{lane.label}</h3>
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
          <Card className="p-4 border-dashed text-center text-xs text-muted-foreground">Déposez un dossier ici</Card>
        )}
      </div>
    </div>
  );
}

export function DossiersKanbanBoard({
  items, lanes, laneOf, statusForLane, canEdit, statsById, inconsistencyById, poleById, externalUnread = {},
}: {
  items: any[];
  lanes: KanbanLane[];
  laneOf: (statut: string | null | undefined) => string;
  statusForLane: (laneKey: string) => string;
  canEdit: boolean;
  statsById: Record<string, any>;
  inconsistencyById: Record<string, any>;
  poleById: Map<string, any>;
  externalUnread?: Record<string, number>;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [order, setOrder] = useState<Record<string, string[]>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<string | null>(null);
  // Lane override applied optimistically while the server update is in flight
  const [laneOverride, setLaneOverride] = useState<Record<string, string>>({});

  useEffect(() => { setOrder(loadOrder()); }, []);

  const byId = useMemo(() => new Map(items.map((d) => [d.id, d])), [items]);

  const laneKeyOf = (d: any) => laneOverride[d.id] ?? laneOf(d.statut);

  const columns = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const l of lanes) m[l.key] = [];
    for (const d of items) (m[laneKeyOf(d)] ??= m[lanes[0].key]).push(d);
    // apply saved manual order
    for (const l of lanes) {
      const saved = order[l.key] ?? [];
      m[l.key].sort((a, b) => {
        const ia = saved.indexOf(a.id), ib = saved.indexOf(b.id);
        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
    }
    return m;
  }, [items, lanes, order, laneOverride]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function findLaneOfId(id: string): string | null {
    for (const l of lanes) if ((columns[l.key] ?? []).some((d) => d.id === id)) return l.key;
    return null;
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

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
      toast.error("Vous n'avez pas les droits pour déplacer ce dossier.");
      return;
    }

    // 1) Reorder inside the same column
    if (sourceLane === targetLane) {
      const list = columns[sourceLane].map((d) => d.id);
      const from = list.indexOf(activeCardId);
      const to = overId.startsWith("lane:") ? list.length - 1 : list.indexOf(overId);
      if (from === -1 || to === -1 || from === to) return;
      const next = { ...order, [sourceLane]: arrayMove(list, from, to) };
      setOrder(next);
      saveOrder(next);
      return;
    }

    // 2) Move to another column → status change
    const dossier = byId.get(activeCardId);
    const previousStatut = dossier?.statut;
    const newStatut = statusForLane(targetLane);

    const targetIds = columns[targetLane].map((d) => d.id);
    const insertAt = overId.startsWith("lane:") ? targetIds.length : Math.max(0, targetIds.indexOf(overId));
    const nextOrder = {
      ...order,
      [sourceLane]: columns[sourceLane].map((d) => d.id).filter((id) => id !== activeCardId),
      [targetLane]: [...targetIds.slice(0, insertAt), activeCardId, ...targetIds.slice(insertAt)],
    };
    setOrder(nextOrder);
    saveOrder(nextOrder);
    setLaneOverride((o) => ({ ...o, [activeCardId]: targetLane }));

    const { error } = await supabase
      .from("dossiers")
      .update({ statut: newStatut as any })
      .eq("id", activeCardId);

    if (error) {
      setLaneOverride((o) => {
        const n = { ...o };
        delete n[activeCardId];
        return n;
      });
      toast.error("Déplacement impossible", { description: error.message });
      return;
    }

    toast.success(`Dossier déplacé vers « ${lanes.find((l) => l.key === targetLane)?.label} »`);
    await queryClient.invalidateQueries({ queryKey: ["admin-dossiers"] });
    setLaneOverride((o) => {
      const n = { ...o };
      delete n[activeCardId];
      return n;
    });
    void previousStatut;
  }

  const activeDossier = activeId ? byId.get(activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { setActiveId(null); setOverLane(null); }}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {lanes.map((lane) => {
          const list = columns[lane.key] ?? [];
          return (
            <KanbanColumn key={lane.key} lane={lane} ids={list.map((d) => d.id)} isOver={overLane === lane.key}>
              {list.map((d) => (
                <SortableCard
                  key={d.id}
                  d={d}
                  canDrag={canEdit}
                  poleById={poleById}
                  statsById={statsById}
                  inconsistencyById={inconsistencyById}
                  externalUnread={externalUnread}
                  onOpen={(id, unread) => navigate({ to: `/dossiers/${id}${unread > 0 ? "#audit-chat" : ""}` })}
                />
              ))}
            </KanbanColumn>
          );
        })}
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
        {activeDossier ? (
          <div className="rotate-2 opacity-95 w-[280px] max-w-[85vw]">
            <CardContent
              d={activeDossier}
              dragging
              poleById={poleById}
              statsById={statsById}
              inconsistencyById={inconsistencyById}
              externalUnread={externalUnread}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable, closestCorners, type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { CalendarClock, GripVertical, RotateCcw, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  currentEtapes, dossierState, frDate, personName, todayIso, PC_TONES,
  type PcDossier, type PcDossierState, type PcEtape, type PcType,
} from "@/lib/pole-certification";
import { PcStatusBadge } from "./pc-status";
import { PC_ALL_KEY } from "./use-pc";
import type { PcViewProps } from "./pc-view-types";

interface CardData { d: PcDossier; s: PcDossierState; steps: PcEtape[]; draggable: boolean }
interface Pending { card: CardData; to: number; steps: PcEtape[] }

export function PcKanban({ dossiers, etapes, documents, membres, profiles }: PcViewProps) {
  const { user } = useAuth();
  const { isDirectionOrAdmin } = useRole();
  const qc = useQueryClient();
  const [choix, setType] = useState<PcType>(() => (dossiers.some((d) => d.type === "certificateur") || !dossiers.length ? "certificateur" : "edof"));
  // Si le filtre « type » ne laisse qu'un seul type, les colonnes le suivent sans second sélecteur.
  const typesPresents = new Set(dossiers.map((d) => d.type));
  const typeUnique = typesPresents.size === 1 ? [...typesPresents][0] : null;
  const type: PcType = typeUnique ?? choix;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  // Étapes types : intitulés des colonnes même quand aucun dossier n'est encore à cette étape.
  const { data: modeles = [] } = useQuery({
    queryKey: ["pc-etape-modeles", type, "colonnes"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("pc_etape_modeles").select("ordre, intitule").eq("dossier_type", type).eq("actif", true).order("ordre");
      if (error) throw error;
      return (data ?? []) as { ordre: number; intitule: string }[];
    },
  });

  const { columns, cards } = useMemo(() => {
    const today = todayIso();
    const list = dossiers.filter((d) => d.type === type);
    const cards: CardData[] = list.map((d) => {
      const steps = currentEtapes(etapes.filter((e) => e.dossier_id === d.id));
      const canWrite = !!user && !d.archived_at && (isDirectionOrAdmin || d.responsable_id === user.id
        || membres.some((m) => m.dossier_id === d.id && m.user_id === user.id && m.role === "collaborateur"));
      return { d, s: dossierState(d, etapes, documents, today), steps, draggable: canWrite };
    });
    // Libellé de colonne = intitulé le plus fréquent à cette position.
    const max = Math.max(modeles.length, ...cards.map((c) => c.steps.length));
    const columns: string[] = [];
    for (let i = 0; i < max; i++) {
      const counts = new Map<string, number>();
      for (const c of cards) {
        const e = c.steps[i];
        if (e) counts.set(`${e.ordre}. ${e.intitule}`, (counts.get(`${e.ordre}. ${e.intitule}`) ?? 0) + 1);
      }
      const m = modeles[i];
      columns.push([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (m ? `${m.ordre}. ${m.intitule}` : `Étape ${i + 1}`));
    }
    columns.push("Terminé");
    return { columns, cards };
  }, [dossiers, etapes, documents, membres, type, user, isDirectionOrAdmin, modeles]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const columnOf = (c: CardData) => (c.s.statut === "termine" ? columns.length - 1 : Math.min(c.s.index, columns.length - 2));

  function onDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)); }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const card = cards.find((c) => c.d.id === e.active.id);
    const over = e.over?.id ? String(e.over.id) : null;
    if (!card || !over?.startsWith("col:")) return;
    const k = Number(over.slice(4));
    const from = columnOf(card);
    if (k === from) return;
    if (k < from) { toast.info("Pour revenir en arrière, ouvrez la fiche du dossier."); return; }
    // Colonne « Terminé » = toutes les étapes restantes ; sinon les étapes entre la position actuelle et k-1.
    const end = k === columns.length - 1 ? card.steps.length : Math.min(k, card.steps.length);
    const steps = card.steps.slice(from, end).filter((x) => x.statut !== "valide");
    if (steps.length === 0) return;
    setPending({ card, to: k, steps });
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    let done = 0;
    for (const step of pending.steps) {
      const { error } = await (supabase as any).from("pc_etapes").update({ statut: "valide" }).eq("id", step.id);
      if (error) { toast.error(`Étape ${step.ordre} non validée : ${error.message}`); break; }
      done++;
    }
    if (done) toast.success(`${done} étape(s) validée(s)`);
    setBusy(false);
    setPending(null);
    qc.invalidateQueries({ queryKey: PC_ALL_KEY });
  }

  const active = cards.find((c) => c.d.id === activeId);

  return (
    <div className="space-y-3">
      {!typeUnique && <Tabs value={type} onValueChange={(v) => setType(v as PcType)}>
        <TabsList className="w-fit sm:justify-start">
          <TabsTrigger value="certificateur">Certificateur ({dossiers.filter((d) => d.type === "certificateur").length})</TabsTrigger>
          <TabsTrigger value="edof">EDOF ({dossiers.filter((d) => d.type === "edof").length})</TabsTrigger>
        </TabsList>
      </Tabs>}
      <p className="text-xs text-muted-foreground">Glissez une carte vers la droite pour valider ses étapes. Une confirmation est demandée.</p>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="flex gap-3 overflow-x-auto pb-3 snap-x snap-mandatory scroll-smooth [-webkit-overflow-scrolling:touch]">
          {columns.map((label, i) => (
            <Column key={i} index={i} label={label} cards={cards.filter((c) => columnOf(c) === i)} profiles={profiles} activeId={activeId} />
          ))}
        </div>
        <DragOverlay>{active ? <KanbanCard card={active} profiles={profiles} overlay /> : null}</DragOverlay>
      </DndContext>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && !busy && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Valider {pending && pending.steps.length > 1 ? `les étapes ${pending.steps[0].ordre} à ${pending.steps[pending.steps.length - 1].ordre}` : `l'étape ${pending?.steps[0]?.ordre}`} ?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1">
                <p>« {pending?.card.d.titre} » — les étapes suivantes passeront au statut « Validé » :</p>
                <ul className="list-disc pl-5">
                  {pending?.steps.map((s) => <li key={s.id}>{s.ordre}. {s.intitule}</li>)}
                </ul>
                <p className="text-xs">Une étape bloquée (pièce périmée) arrête la validation.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Annuler</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); confirm(); }}>{busy ? "Validation…" : "Valider"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Column({ index, label, cards, profiles, activeId }: { index: number; label: string; cards: CardData[]; profiles: PcViewProps["profiles"]; activeId: string | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${index}` });
  return (
    <div ref={setNodeRef} className={cn("snap-start shrink-0 w-[260px] sm:w-[280px] rounded-xl bg-muted/40 flex flex-col transition-colors", isOver && "bg-gold/10 ring-2 ring-gold")}>
      <div className="px-3 pt-3 pb-1 flex items-start justify-between gap-2">
        <span className="text-xs font-medium line-clamp-2" title={label}>{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{cards.length}</span>
      </div>
      <div className="p-2 space-y-2 min-h-[120px]">
        {cards.map((c) => <DraggableCard key={c.d.id} card={c} profiles={profiles} hidden={activeId === c.d.id} />)}
        {cards.length === 0 && <p className="text-xs text-muted-foreground/70 px-1 py-2">Aucun dossier à cette étape.</p>}
      </div>
    </div>
  );
}

function DraggableCard({ card, profiles, hidden }: { card: CardData; profiles: PcViewProps["profiles"]; hidden: boolean }) {
  const { setNodeRef, attributes, listeners } = useDraggable({ id: card.d.id, disabled: !card.draggable });
  return (
    <div ref={setNodeRef} className={cn(hidden && "opacity-30")}>
      <KanbanCard card={card} profiles={profiles} handle={card.draggable ? { ...attributes, ...listeners } : undefined} />
    </div>
  );
}

function KanbanCard({ card, profiles, handle, overlay }: { card: CardData; profiles: PcViewProps["profiles"]; handle?: Record<string, any>; overlay?: boolean }) {
  const { d, s } = card;
  const t = PC_TONES[s.tone];
  return (
    <div className={cn("rounded-lg border bg-card p-3 text-sm shadow-sm border-l-4 transition-shadow motion-reduce:transition-none", overlay && "shadow-xl scale-[1.02] motion-reduce:scale-100")} style={{ borderLeftColor: t.hex }}>
      <div className="flex items-start gap-1">
        <Link to="/pole-certification/$id" params={{ id: d.id }} className="font-medium leading-snug hover:underline flex-1 min-w-0">{d.titre}</Link>
        {handle && (
          <button type="button" className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none p-0.5" aria-label="Déplacer la carte" {...handle}>
            <GripVertical className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <PcStatusBadge tone={s.tone} />
        {s.tentatives > 1 && (
          <span className="inline-flex items-center gap-1 text-xs text-orange-700 dark:text-orange-300"><RotateCcw className="h-3 w-3" /> tentative {s.tentatives}</span>
        )}
      </div>
      <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
        <p className="flex items-center gap-1"><User className="h-3 w-3" /> {personName(profiles.get(d.responsable_id))}</p>
        {s.prochaineEcheance && (
          <p className={cn("flex items-center gap-1", s.enRetard && "text-red-700 dark:text-red-300 font-medium")}>
            <CalendarClock className="h-3 w-3" /> {frDate(s.prochaineEcheance)}
          </p>
        )}
      </div>
    </div>
  );
}

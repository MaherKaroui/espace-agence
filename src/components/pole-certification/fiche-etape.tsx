import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown, ArrowUp, BellOff, ChevronDown, Mail, Paperclip, Plus, RotateCcw, Scale, ShieldAlert, Trash2, Upload,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  PC_STATUTS, PC_TONES, addDaysIso, currentEtapes, docState, etapeTone, frDate, frDateTime,
  openPcFile, perimeeAu, personName, relanceMailto, todayIso, uploadPcFile,
  type PcEtape, type PcStatut,
} from "@/lib/pole-certification";
import { PcStatusBadge } from "./pc-status";
import { errMsg, useFicheRefresh, type FicheCtx } from "./fiche-context";

const db = supabase as any;

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export function FicheEtapes({ ctx }: { ctx: FicheCtx }) {
  const refresh = useFicheRefresh(ctx.dossier.id);
  const cur = currentEtapes(ctx.etapes);
  const [adding, setAdding] = useState("");

  const move = async (i: number, dir: -1 | 1) => {
    const a = cur[i], b = cur[i + dir];
    if (!a || !b) return;
    const r1 = await db.from("pc_etapes").update({ ordre: b.ordre }).eq("groupe", a.groupe);
    const r2 = r1.error ? r1 : await db.from("pc_etapes").update({ ordre: a.ordre }).eq("groupe", b.groupe);
    if (r1.error || r2.error) toast.error(errMsg(r1.error ?? r2.error));
    refresh();
  };

  const addStep = async () => {
    const intitule = adding.trim();
    if (!intitule) return;
    const ordre = (cur.length ? Math.max(...cur.map((e) => e.ordre)) : 0) + 1;
    const { error } = await db.from("pc_etapes").insert({
      dossier_id: ctx.dossier.id, ordre, intitule, responsable_id: ctx.dossier.responsable_id,
    });
    if (error) return toast.error(errMsg(error));
    setAdding("");
    toast.success("Étape ajoutée");
    refresh();
  };

  return (
    <div className="space-y-3">
      {cur.map((e, i) => (
        <EtapeCard
          key={e.id}
          ctx={ctx}
          etape={e}
          previous={ctx.etapes.filter((x) => x.groupe === e.groupe && x.id !== e.id).sort((a, b) => a.tentative - b.tentative)}
          onUp={i > 0 ? () => move(i, -1) : undefined}
          onDown={i < cur.length - 1 ? () => move(i, 1) : undefined}
        />
      ))}
      {ctx.canWrite && (
        <Card className="p-3 flex flex-col sm:flex-row gap-2">
          <Input placeholder="Intitulé de la nouvelle étape" value={adding} onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addStep(); }} />
          <Button onClick={addStep} disabled={!adding.trim()}><Plus className="h-4 w-4 mr-1" /> Ajouter une étape</Button>
        </Card>
      )}
    </div>
  );
}

function EtapeCard({
  ctx, etape: e, previous, onUp, onDown,
}: { ctx: FicheCtx; etape: PcEtape; previous: PcEtape[]; onUp?: () => void; onDown?: () => void }) {
  const refresh = useFicheRefresh(ctx.dossier.id);
  const ro = !ctx.canWrite;
  const [intitule, setIntitule] = useState(e.intitule);
  const [notes, setNotes] = useState(e.notes ?? "");
  const [refusOpen, setRefusOpen] = useState(false);
  const [recoursOpen, setRecoursOpen] = useState(false);
  const [recommencerOpen, setRecommencerOpen] = useState(false);
  const [forcerOpen, setForcerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setIntitule(e.intitule); }, [e.intitule]);
  useEffect(() => { setNotes(e.notes ?? ""); }, [e.notes]);

  const update = async (patch: Partial<PcEtape>, okMsg?: string) => {
    const { error } = await db.from("pc_etapes").update(patch).eq("id", e.id);
    if (error) {
      if (/périmée/i.test(error.message ?? "") && ctx.isAdmin) {
        toast.error(error.message, { action: { label: "Forcer", onClick: () => setForcerOpen(true) } });
      } else toast.error(errMsg(error));
      return false;
    }
    if (okMsg) toast.success(okMsg);
    refresh();
    return true;
  };

  const setStatut = (s: PcStatut) => {
    if (s === e.statut) return;
    if (s === "refuse") return setRefusOpen(true);
    if (s === "recours") return setRecoursOpen(true);
    update({ statut: s }, `Statut : ${PC_STATUTS.find((x) => x.value === s)?.label}`);
  };

  const attachments = ctx.fichiers.filter((f) => f.etape_id === e.id && !f.document_id);
  const tentatives = previous.length + 1;
  const tone = etapeTone(e);

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const path = await uploadPcFile(ctx.dossier.id, file);
        const { error } = await db.from("pc_fichiers").insert({
          dossier_id: ctx.dossier.id, etape_id: e.id, storage_path: path, filename: file.name,
          mime_type: file.type || null, file_size: file.size, uploaded_by: ctx.uid,
        });
        if (error) throw error;
      }
      toast.success("Pièce jointe ajoutée");
      refresh();
    } catch (err: any) {
      toast.error(errMsg(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const prepareRelance = async () => {
    window.location.href = relanceMailto(ctx.dossier, e);
    await db.from("pc_evenements").insert({
      dossier_id: ctx.dossier.id, etape_id: e.id, actor_id: ctx.uid, action: "relance.envoyee",
      details: { ordre: e.ordre, intitule: e.intitule },
    });
    refresh();
  };

  const remove = async () => {
    const { data, error } = await db.from("pc_etapes").delete().eq("id", e.id).select("id");
    setDeleteOpen(false);
    if (error) return toast.error(errMsg(error));
    if (!data?.length) return toast.error("Suppression impossible : une étape refusée ou avec plusieurs tentatives est conservée pour la traçabilité.");
    toast.success("Étape supprimée");
    refresh();
  };

  const relanceLe = e.statut === "en_attente" && e.envoye_at && e.relance_jours
    ? addDaysIso(e.envoye_at.slice(0, 10), e.relance_jours) : null;
  const checklist = Object.entries(e.checklist ?? {});

  return (
    <Card id={`etape-${e.id}`} className="p-3 md:p-4 space-y-3 border-l-4" style={{ borderLeftColor: PC_TONES[tone].hex }}>
      {/* En-tête de l'étape */}
      <div className="flex flex-wrap items-start gap-2">
        <span className="font-display text-lg tabular-nums w-8 shrink-0">{e.ordre}</span>
        <div className="flex-1 min-w-[12rem]">
          <Input
            value={intitule}
            disabled={ro}
            aria-label="Intitulé de l'étape"
            className="font-medium border-transparent hover:border-input focus:border-input px-1"
            onChange={(ev) => setIntitule(ev.target.value)}
            onBlur={() => { if (intitule.trim() && intitule !== e.intitule) update({ intitule: intitule.trim() }); else setIntitule(e.intitule); }}
          />
          {e.a_saisir && <p className="text-xs text-muted-foreground px-1 mt-0.5">À saisir / joindre : {e.a_saisir}</p>}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <PcStatusBadge tone={tone} />
          {tentatives > 1 && <Badge variant="outline">Tentative {e.tentative}</Badge>}
          {e.force_par && <Badge variant="outline" className="gap-1"><ShieldAlert className="h-3 w-3" /> Forcé</Badge>}
          {!ro && (
            <>
              <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!onUp} onClick={onUp} aria-label="Monter"><ArrowUp className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!onDown} onClick={onDown} aria-label="Descendre"><ArrowDown className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDeleteOpen(true)} aria-label="Supprimer l'étape"><Trash2 className="h-4 w-4" /></Button>
            </>
          )}
        </div>
      </div>

      {/* Statut + dates */}
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-5">
        <div className="grid gap-1 col-span-2 lg:col-span-1">
          <Label className="text-xs">Statut</Label>
          <Select value={e.statut} onValueChange={(v) => setStatut(v as PcStatut)} disabled={ro}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PC_STATUTS.filter((s) => s.value !== "a_recommencer").map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DateField label="Début" value={e.date_debut} disabled={ro} onChange={(v) => update({ date_debut: v })} />
        <DateField label="Échéance" value={e.date_echeance} disabled={ro} onChange={(v) => update({ date_echeance: v })} />
        <DateField label="Réalisation" value={e.date_realisation} disabled={ro} onChange={(v) => update({ date_realisation: v })} />
        <div className="grid gap-1 col-span-2 lg:col-span-1">
          <Label className="text-xs">Responsable de l'étape</Label>
          <Select value={e.responsable_id ?? ctx.dossier.responsable_id} onValueChange={(v) => update({ responsable_id: v }, "Responsable de l'étape modifié")} disabled={ro}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{ctx.staff.map((p) => <SelectItem key={p.id} value={p.id}>{personName(p)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Champs spécifiques */}
      {(e.event_kind || e.lien_expiration) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {e.event_kind && (
            <div className="grid gap-1">
              <Label className="text-xs">{e.event_kind === "visio" ? "Date et heure de la visio" : "Date et heure du webinaire"} (rappel la veille et 1 h avant)</Label>
              <Input type="datetime-local" disabled={ro} defaultValue={toLocalInput(e.event_at)} key={e.event_at ?? "none"}
                onBlur={(ev) => { const v = fromLocalInput(ev.target.value); if (v !== e.event_at) update({ event_at: v }); }} />
            </div>
          )}
          {e.lien_expiration && (
            <div className="grid gap-1">
              <Label className="text-xs">Expiration du lien / code CDC (alerte 2 jours avant)</Label>
              <Input type="datetime-local" disabled={ro} defaultValue={toLocalInput(e.lien_expire_at)} key={e.lien_expire_at ?? "none"}
                onBlur={(ev) => { const v = fromLocalInput(ev.target.value); if (v !== e.lien_expire_at) update({ lien_expire_at: v }); }} />
            </div>
          )}
        </div>
      )}

      {e.collecte_pieces && <CollectePieces ctx={ctx} />}

      {checklist.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {checklist.map(([k, v]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <Checkbox checked={!!v} disabled={ro} onCheckedChange={(c) => update({ checklist: { ...e.checklist, [k]: c === true } })} />
              {k}
            </label>
          ))}
        </div>
      )}

      {/* Champ libre */}
      <div className="grid gap-1">
        <Label className="text-xs">Ce qui a été fait, réponse reçue, prochaine action</Label>
        <Textarea rows={3} value={notes} disabled={ro} onChange={(ev) => setNotes(ev.target.value)}
          onBlur={() => { if (notes !== (e.notes ?? "")) update({ notes: notes || null }, "Note enregistrée"); }} />
      </div>

      {/* Refus / recours */}
      {(e.statut === "refuse" || e.statut === "recours") && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 space-y-2 text-sm">
          <p><span className="font-medium">Motif du refus :</span> {e.motif_refus || "—"}</p>
          {e.date_limite_recours && <p><span className="font-medium">Date limite de recours :</span> {frDate(e.date_limite_recours)}</p>}
          {!ro && (
            <div className="flex flex-wrap gap-2">
              {e.statut === "refuse" && (
                <Button size="sm" variant="outline" onClick={() => setRecoursOpen(true)}><Scale className="h-4 w-4 mr-1" /> Recours</Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setRecommencerOpen(true)}><RotateCcw className="h-4 w-4 mr-1" /> À recommencer</Button>
            </div>
          )}
        </div>
      )}

      {/* Pièces jointes + actions */}
      <div className="flex flex-wrap items-center gap-2">
        {attachments.map((f) => (
          <Button key={f.id} size="sm" variant="secondary" className="max-w-[16rem]"
            onClick={() => openPcFile(f).catch((err) => toast.error(errMsg(err)))}>
            <Paperclip className="h-3.5 w-3.5 mr-1 shrink-0" /><span className="truncate">{f.filename}</span>
          </Button>
        ))}
        {!ro && (
          <>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(ev) => onUpload(ev.target.files)} />
            <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1" /> {uploading ? "Envoi…" : "Joindre"}
            </Button>
            <ReportRappel value={e.rappel_reporte_jusqua} onPick={(iso) => update({ rappel_reporte_jusqua: iso }, `Rappel reporté au ${frDateTime(iso)}`)} />
            {e.statut === "en_attente" && (
              <Button size="sm" variant="outline" onClick={prepareRelance}><Mail className="h-4 w-4 mr-1" /> Préparer la relance</Button>
            )}
          </>
        )}
        <label className="flex items-center gap-2 text-sm ml-auto">
          <Checkbox checked={e.statut === "valide"} disabled={ro}
            onCheckedChange={(c) => setStatut(c === true ? "valide" : "en_cours")} />
          Étape terminée
        </label>
      </div>
      {(relanceLe || e.rappel_reporte_jusqua) && (
        <p className="text-xs text-muted-foreground">
          {relanceLe && <>Envoyé le {frDate(e.envoye_at)} — relance prévue le {frDate(relanceLe)}. </>}
          {e.rappel_reporte_jusqua && new Date(e.rappel_reporte_jusqua) > new Date() && <>Rappels suspendus jusqu'au {frDateTime(e.rappel_reporte_jusqua)}.</>}
        </p>
      )}

      {previous.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className="h-3.5 w-3.5" /> {previous.length} tentative(s) précédente(s)
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            {previous.map((p) => (
              <div key={p.id} className="rounded-md border bg-muted/30 p-2 text-xs space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Tentative {p.tentative}</span>
                  <PcStatusBadge tone={p.statut} />
                  <span className="text-muted-foreground">Échéance {frDate(p.date_echeance)} · Réalisée {frDate(p.date_realisation)}</span>
                </div>
                {p.motif_refus && <p><span className="font-medium">Motif :</span> {p.motif_refus}</p>}
                {p.notes && <p className="whitespace-pre-wrap">{p.notes}</p>}
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      <RefusDialog open={refusOpen} onOpenChange={setRefusOpen}
        onSubmit={(motif, limite) => update({ statut: "refuse", motif_refus: motif, date_limite_recours: limite }, "Refus enregistré")} />
      <RecoursDialog open={recoursOpen} onOpenChange={setRecoursOpen} initial={e.date_limite_recours}
        onSubmit={(limite) => update({ statut: "recours", date_limite_recours: limite }, "Recours enregistré")} />
      <RecommencerDialog open={recommencerOpen} onOpenChange={setRecommencerOpen}
        onSubmit={async (echeance) => {
          const { error } = await db.rpc("pc_recommencer_etape", { _etape: e.id, _echeance: echeance });
          if (error) { toast.error(errMsg(error)); return false; }
          toast.success(`Tentative ${e.tentative + 1} créée`);
          refresh();
          return true;
        }} />
      <ForcerDialog open={forcerOpen} onOpenChange={setForcerOpen}
        onSubmit={(motif) => update({ statut: "valide", force_motif: motif }, "Étape validée par forçage administrateur")} />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer l'étape {e.ordre} ?</AlertDialogTitle>
            <AlertDialogDescription>« {e.intitule} » sera retirée du parcours (la suppression est notée dans l'historique).</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function DateField({ label, value, disabled, onChange }: { label: string; value: string | null; disabled: boolean; onChange: (v: string | null) => void }) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Input type="date" value={value ?? ""} disabled={disabled} onChange={(ev) => onChange(ev.target.value || null)} />
    </div>
  );
}

/** Bouton « Reporter le rappel » : 1 jour, 3 jours ou date choisie. */
export function ReportRappel({ value, onPick }: { value: string | null; onPick: (iso: string) => void }) {
  const [date, setDate] = useState("");
  const [open, setOpen] = useState(false);
  const pick = (iso: string) => { onPick(iso); setOpen(false); };
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline"><BellOff className="h-4 w-4 mr-1" /> Reporter le rappel</Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 space-y-2">
        {value && new Date(value) > new Date() && <p className="text-xs text-muted-foreground">Reporté jusqu'au {frDateTime(value)}</p>}
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => pick(inDays(1))}>1 jour</Button>
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => pick(inDays(3))}>3 jours</Button>
        </div>
        <div className="flex gap-2">
          <Input type="date" value={date} min={todayIso()} onChange={(ev) => setDate(ev.target.value)} />
          <Button size="sm" disabled={!date} onClick={() => pick(new Date(date + "T08:00:00").toISOString())}>OK</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Étape de collecte (EDOF 0) : pièces attendues, manquantes en rouge, péremption avant envoi en orange. */
function CollectePieces({ ctx }: { ctx: FicheCtx }) {
  const expected = ctx.pieceTypes.filter((t) => t.actif && t.dossier_types.includes(ctx.dossier.type)).sort((a, b) => a.ordre - b.ordre);
  const envoi = currentEtapes(ctx.etapes).find((x) => x.bloque_si_piece_perimee)?.date_echeance ?? null;
  return (
    <div className="rounded-md border p-3 space-y-1.5">
      <p className="text-sm font-medium text-muted-foreground">
        Pièces attendues {envoi ? `— envoi prévu le ${frDate(envoi)}` : "— fixez l'échéance de l'étape « Déposer les documents » pour vérifier la validité à l'envoi"}
      </p>
      <ul className="space-y-1 text-sm">
        {expected.map((t) => {
          const doc = ctx.documents.find((d) => d.piece_type_id === t.id);
          const st = doc ? docState(doc).state : null;
          const lateAtSend = doc && perimeeAu(doc, envoi);
          return (
            <li key={t.id} className="flex flex-wrap items-center gap-2">
              {!doc ? (
                <span className={t.obligatoire ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}>
                  ✗ {t.libelle} {t.obligatoire ? "(manquante)" : "(si concerné)"}
                </span>
              ) : (
                <>
                  <span>✓ {t.libelle}</span>
                  {st === "perime" ? <PcStatusBadge tone="refuse" label="Périmée" />
                    : lateAtSend ? <PcStatusBadge tone="bientot" label={`Aura plus de ${doc.validite_jours} j à l'envoi`} />
                    : st === "bientot" ? <PcStatusBadge tone="bientot" />
                    : st === "sans_date" ? <PcStatusBadge tone="a_faire" label="Date d'émission manquante" /> : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RefusDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (motif: string, limite: string | null) => Promise<boolean> }) {
  const [motif, setMotif] = useState("");
  const [limite, setLimite] = useState("");
  useEffect(() => { if (open) { setMotif(""); setLimite(""); } }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Étape refusée</DialogTitle>
          <DialogDescription>Le motif est obligatoire. Vous choisirez ensuite : recours ou à recommencer.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-1.5"><Label>Motif du refus *</Label><Textarea rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Délai de recours (date limite)</Label><Input type="date" value={limite} onChange={(e) => setLimite(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button disabled={!motif.trim()} onClick={async () => { if (await onSubmit(motif.trim(), limite || null)) onOpenChange(false); }}>Enregistrer le refus</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecoursDialog({ open, onOpenChange, initial, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; initial: string | null; onSubmit: (limite: string | null) => Promise<boolean> }) {
  const [limite, setLimite] = useState("");
  useEffect(() => { if (open) setLimite(initial ?? ""); }, [open, initial]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Engager un recours</DialogTitle></DialogHeader>
        <div className="grid gap-1.5"><Label>Date limite du recours</Label><Input type="date" value={limite} onChange={(e) => setLimite(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={async () => { if (await onSubmit(limite || null)) onOpenChange(false); }}>Passer en recours</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecommencerDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (echeance: string) => Promise<boolean> }) {
  const [echeance, setEcheance] = useState("");
  useEffect(() => { if (open) setEcheance(addDaysIso(todayIso(), 7)); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recommencer l'étape</DialogTitle>
          <DialogDescription>L'étape est dupliquée (nouvelle tentative) ; l'ancienne reste visible dans l'historique. Vérifiez la validité des pièces pour ce nouvel envoi.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5"><Label>Nouvelle date d'échéance *</Label><Input type="date" value={echeance} onChange={(e) => setEcheance(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button disabled={!echeance} onClick={async () => { if (await onSubmit(echeance)) onOpenChange(false); }}>Créer la nouvelle tentative</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ForcerDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (motif: string) => Promise<boolean> }) {
  const [motif, setMotif] = useState("");
  useEffect(() => { if (open) setMotif(""); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Forcer la validation (administrateur)</DialogTitle>
          <DialogDescription>Une ou plusieurs pièces sont périmées. Le forçage et son motif sont notés dans l'historique.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5"><Label>Motif du forçage *</Label><Textarea rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button disabled={!motif.trim()} onClick={async () => { if (await onSubmit(motif.trim())) onOpenChange(false); }}>Forcer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

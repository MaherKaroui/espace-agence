import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, FileText, Plus, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DOC_STATE_UI, PC_ACCEPT_PIECES, currentEtapes, docState, frDate, frDateTime, openPcFile, personName,
  todayIso, uploadPcFile, type PcDocument,
} from "@/lib/pole-certification";
import { PcStatusBadge } from "./pc-status";
import { ReportRappel } from "./fiche-etape";
import { errMsg, useFicheRefresh, type FicheCtx } from "./fiche-context";

const db = supabase as any;

/** Pièces du dossier : validité (émission + durée), versions successives, étapes concernées (§6). */
export function FicheDocuments({ ctx }: { ctx: FicheCtx }) {
  const [adding, setAdding] = useState(false);
  const expected = ctx.pieceTypes.filter((t) => t.actif && t.dossier_types.includes(ctx.dossier.type));
  const missing = expected.filter((t) => t.obligatoire && !ctx.documents.some((d) => d.piece_type_id === t.id));
  const docs = [...ctx.documents].sort((a, b) => (a.date_peremption ?? "9999").localeCompare(b.date_peremption ?? "9999"));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Péremption calculée automatiquement : date d'émission + durée de validité (3 mois par défaut). Alerte 15 puis 7 jours avant.
        </p>
        {ctx.canWrite && <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4 mr-1" /> Ajouter une pièce</Button>}
      </div>

      {missing.length > 0 && (
        <Card className="p-3 border-red-500/40 bg-red-500/5 text-sm">
          <p className="font-medium text-red-700 dark:text-red-300">Pièces obligatoires manquantes :</p>
          <ul className="list-disc pl-5 text-red-700 dark:text-red-300">{missing.map((t) => <li key={t.id}>{t.libelle}</li>)}</ul>
        </Card>
      )}

      {docs.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground text-center">Aucune pièce pour l'instant.</Card>
      ) : (
        docs.map((d) => <DocumentRow key={d.id} ctx={ctx} doc={d} />)
      )}

      <AddPieceDialog ctx={ctx} open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function DocumentRow({ ctx, doc }: { ctx: FicheCtx; doc: PcDocument }) {
  const refresh = useFicheRefresh(ctx.dossier.id);
  const ro = !ctx.canWrite;
  const { state, joursRestants } = docState(doc);
  const ui = DOC_STATE_UI[state];
  const type = ctx.pieceTypes.find((t) => t.id === doc.piece_type_id);
  const versions = ctx.fichiers.filter((f) => f.document_id === doc.id).sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
  const steps = currentEtapes(ctx.etapes);
  const [versionOpen, setVersionOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const update = async (patch: Partial<PcDocument>, ok?: string) => {
    const { error } = await db.from("pc_documents").update(patch).eq("id", doc.id);
    if (error) return toast.error(errMsg(error));
    if (ok) toast.success(ok);
    refresh();
  };

  const toggleEtape = (groupe: string, on: boolean) =>
    update({ etapes: on ? [...new Set([...doc.etapes, groupe])] : doc.etapes.filter((g) => g !== groupe) });

  const remove = async () => {
    setDeleteOpen(false);
    const { error } = await db.from("pc_documents").delete().eq("id", doc.id);
    if (error) return toast.error(errMsg(error));
    toast.success("Pièce supprimée");
    refresh();
  };

  return (
    <Card className="p-3 space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <FileText className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-[12rem]">
          <p className="font-medium">{doc.nom}</p>
          <p className="text-xs text-muted-foreground">{type?.libelle ?? "Type libre"}{doc.version > 0 && ` · version ${doc.version}`}</p>
        </div>
        <PcStatusBadge tone={ui.tone} label={ui.label} />
      </div>

      <div className="grid gap-2 grid-cols-2 md:grid-cols-4 text-sm">
        <div className="grid gap-1">
          <Label className="text-xs">Date d'émission</Label>
          <Input type="date" value={doc.date_emission ?? ""} disabled={ro} max={todayIso()}
            onChange={(e) => update({ date_emission: e.target.value || null })} />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Validité (jours)</Label>
          <Input type="number" min={1} placeholder="Sans péremption" defaultValue={doc.validite_jours ?? ""} key={doc.validite_jours ?? "none"} disabled={ro}
            onBlur={(e) => { const v = e.target.value ? Number(e.target.value) : null; if (v !== doc.validite_jours) update({ validite_jours: v }); }} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Péremption</p>
          <p className="font-medium">{frDate(doc.date_peremption)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Jours restants</p>
          <p className="font-medium tabular-nums">{joursRestants === null ? "—" : joursRestants < 0 ? `Périmée depuis ${-joursRestants} j` : `${joursRestants} j`}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline">
              Étapes : {doc.etapes.length === 0 ? "aucune" : steps.filter((s) => doc.etapes.includes(s.groupe)).map((s) => s.ordre).join(", ")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-1.5">
            {steps.map((s) => (
              <label key={s.groupe} className="flex items-center gap-2 text-sm">
                <Checkbox checked={doc.etapes.includes(s.groupe)} disabled={ro} onCheckedChange={(c) => toggleEtape(s.groupe, c === true)} />
                {s.ordre}. {s.intitule}
              </label>
            ))}
          </PopoverContent>
        </Popover>
        {!ro && (
          <>
            <Button size="sm" variant="outline" onClick={() => setVersionOpen(true)}><Upload className="h-4 w-4 mr-1" /> Nouvelle version</Button>
            <ReportRappel value={doc.rappel_reporte_jusqua} onPick={(iso) => update({ rappel_reporte_jusqua: iso }, `Rappel reporté au ${frDateTime(iso)}`)} />
          </>
        )}
        {ctx.isAdmin && !ro && (
          <Button size="icon" variant="ghost" className="h-8 w-8 ml-auto" onClick={() => setDeleteOpen(true)} aria-label="Supprimer la pièce"><Trash2 className="h-4 w-4" /></Button>
        )}
      </div>

      {versions.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className="h-3.5 w-3.5" /> {versions.length} version(s)
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1">
            {versions.map((f) => (
              <button key={f.id} type="button" className="flex w-full flex-wrap items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                onClick={() => openPcFile(f).catch((e) => toast.error(errMsg(e)))}>
                <span className="font-medium">v{f.version ?? "?"}</span>
                <span className="truncate flex-1">{f.filename}</span>
                <span className="text-muted-foreground">émise le {frDate(f.date_emission)} · déposée le {frDate(f.created_at)} par {personName(ctx.profiles.get(f.uploaded_by ?? ""))}</span>
                {f.id === doc.current_fichier_id && <span className="text-green-700 dark:text-green-300">en vigueur</span>}
              </button>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      <VersionDialog ctx={ctx} doc={doc} open={versionOpen} onOpenChange={setVersionOpen} />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {doc.nom} » ?</AlertDialogTitle>
            <AlertDialogDescription>La pièce et ses versions seront retirées du dossier. La suppression est notée dans l'historique.</AlertDialogDescription>
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

/** Dépose un fichier comme nouvelle version d'une pièce ; l'ancienne version reste consultable. */
async function depositVersion(ctx: FicheCtx, doc: Pick<PcDocument, "id" | "version">, file: File, dateEmission: string | null) {
  const path = await uploadPcFile(ctx.dossier.id, file);
  const version = (doc.version ?? 0) + 1;
  const { data, error } = await db.from("pc_fichiers").insert({
    dossier_id: ctx.dossier.id, document_id: doc.id, version, date_emission: dateEmission, storage_path: path,
    filename: file.name, mime_type: file.type || null, file_size: file.size, uploaded_by: ctx.uid,
  }).select("id").single();
  if (error) throw error;
  const { error: e2 } = await db.from("pc_documents").update({ version, current_fichier_id: data.id, date_emission: dateEmission }).eq("id", doc.id);
  if (e2) throw e2;
}

function VersionDialog({ ctx, doc, open, onOpenChange }: { ctx: FicheCtx; doc: PcDocument; open: boolean; onOpenChange: (o: boolean) => void }) {
  const refresh = useFicheRefresh(ctx.dossier.id);
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setFile(null); setDate(todayIso()); } }, [open]);
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await depositVersion(ctx, doc, file, date || null);
      toast.success("Nouvelle version déposée");
      refresh();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(errMsg(e));
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle version — {doc.nom}</DialogTitle>
          <DialogDescription>L'ancienne version est conservée.</DialogDescription>
        </DialogHeader>
        <FileAndDate ctx={ctx} file={file} setFile={setFile} date={date} setDate={setDate} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button disabled={!file || busy} onClick={submit}>{busy ? "Envoi…" : "Déposer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileAndDate({ ctx, file, setFile, date, setDate }: {
  ctx: FicheCtx; file: File | null; setFile: (f: File | null) => void; date: string; setDate: (d: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-3">
      <div className="grid gap-1.5">
        <Label>Fichier</Label>
        <input ref={ref} type="file" className="hidden" accept={ctx.dossier.type === "edof" ? PC_ACCEPT_PIECES : undefined}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Button type="button" variant="outline" onClick={() => ref.current?.click()}>
          <Upload className="h-4 w-4 mr-1" /> {file ? file.name : "Choisir un fichier"}
        </Button>
        {ctx.dossier.type === "edof" && <p className="text-xs text-muted-foreground">Formats acceptés par la CDC : PDF, PNG, JPG, JPEG, GIF, BMP.</p>}
      </div>
      <div className="grid gap-1.5">
        <Label>Date d'émission de la pièce</Label>
        <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
      </div>
    </div>
  );
}

function AddPieceDialog({ ctx, open, onOpenChange }: { ctx: FicheCtx; open: boolean; onOpenChange: (o: boolean) => void }) {
  const refresh = useFicheRefresh(ctx.dossier.id);
  const types = ctx.pieceTypes.filter((t) => t.actif && t.dossier_types.includes(ctx.dossier.type)).sort((a, b) => a.ordre - b.ordre);
  const [typeId, setTypeId] = useState("libre");
  const [nom, setNom] = useState("");
  const [validite, setValidite] = useState("90");
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTypeId("libre"); setNom(""); setValidite("90"); setFile(null); setDate(todayIso()); } }, [open]);

  const pickType = (id: string) => {
    setTypeId(id);
    const t = types.find((x) => x.id === id);
    if (t) { setNom(t.libelle); setValidite(t.validite_jours ? String(t.validite_jours) : ""); }
  };

  const submit = async () => {
    if (!nom.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await db.from("pc_documents").insert({
        dossier_id: ctx.dossier.id, piece_type_id: typeId === "libre" ? null : typeId, nom: nom.trim(),
        date_emission: date || null, validite_jours: validite ? Number(validite) : null, created_by: ctx.uid,
      }).select("id, version").single();
      if (error) throw error;
      if (file) await depositVersion(ctx, data, file, date || null);
      toast.success("Pièce ajoutée");
      refresh();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(errMsg(e));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Ajouter une pièce</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label>Type de pièce</Label>
            <Select value={typeId} onValueChange={pickType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="libre">Autre (type libre)</SelectItem>
                {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.libelle}{t.obligatoire ? " *" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {types.find((t) => t.id === typeId)?.aide && <p className="text-xs text-muted-foreground">{types.find((t) => t.id === typeId)?.aide}</p>}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5 col-span-2"><Label>Nom *</Label><Input value={nom} onChange={(e) => setNom(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Validité (j)</Label><Input type="number" min={1} placeholder="Aucune" value={validite} onChange={(e) => setValidite(e.target.value)} /></div>
          </div>
          <FileAndDate ctx={ctx} file={file} setFile={setFile} date={date} setDate={setDate} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button disabled={!nom.trim() || busy} onClick={submit}>{busy ? "Envoi…" : "Ajouter"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

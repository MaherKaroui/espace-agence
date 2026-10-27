import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowLeft, Award, Link2, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  dossierState, frDate, pcTypeLabel, personName,
  type PcDossier, type PcDocument, type PcEtape, type PcFichier, type PcMembre, type PcPieceType,
} from "@/lib/pole-certification";
import { PcStatusBadge } from "@/components/pole-certification/pc-status";
import { usePcProfiles, usePcStaff } from "@/components/pole-certification/use-pc";
import { NewPcDossierDialog } from "@/components/pole-certification/new-dossier-dialog";
import { errMsg, ficheKey, useFicheRefresh, type FicheCtx } from "@/components/pole-certification/fiche-context";
import { FicheEtapes } from "@/components/pole-certification/fiche-etape";
import { FicheDocuments } from "@/components/pole-certification/fiche-documents";
import { FicheJournal } from "@/components/pole-certification/fiche-journal";
import { FicheMembres } from "@/components/pole-certification/fiche-membres";

export const Route = createFileRoute("/_authenticated/pole-certification/$id")({
  head: () => ({ meta: [{ title: "Dossier — Pôle Certification & EDOF" }] }),
  component: PcFichePage,
});

const db = supabase as any;

async function fetchFiche(id: string) {
  const [dossier, etapes, documents, fichiers, membres, pieceTypes, enfants] = await Promise.all([
    db.from("pc_dossiers").select("*").eq("id", id).maybeSingle(),
    db.from("pc_etapes").select("*").eq("dossier_id", id),
    db.from("pc_documents").select("*").eq("dossier_id", id),
    db.from("pc_fichiers").select("*").eq("dossier_id", id).order("created_at", { ascending: false }),
    db.from("pc_membres").select("*").eq("dossier_id", id),
    db.from("pc_piece_types").select("*").order("ordre"),
    db.from("pc_dossiers").select("id, titre, type").eq("parent_id", id),
  ]);
  for (const r of [dossier, etapes, documents, fichiers, membres, pieceTypes, enfants]) if (r.error) throw r.error;
  let parent: Pick<PcDossier, "id" | "titre"> | null = null;
  if (dossier.data?.parent_id) {
    const p = await db.from("pc_dossiers").select("id, titre").eq("id", dossier.data.parent_id).maybeSingle();
    parent = p.data ?? null;
  }
  return {
    dossier: dossier.data as PcDossier | null,
    etapes: (etapes.data ?? []) as PcEtape[],
    documents: (documents.data ?? []) as PcDocument[],
    fichiers: (fichiers.data ?? []) as PcFichier[],
    membres: (membres.data ?? []) as PcMembre[],
    pieceTypes: (pieceTypes.data ?? []) as PcPieceType[],
    enfants: (enfants.data ?? []) as Pick<PcDossier, "id" | "titre" | "type">[],
    parent,
  };
}

function PcFichePage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const { isDirectionOrAdmin } = useRole();
  const { data: staff = [] } = usePcStaff();
  const { data, isLoading, error } = useQuery({ queryKey: ficheKey(id), enabled: !!user, queryFn: () => fetchFiche(id) });
  const profiles = usePcProfiles([
    data?.dossier?.responsable_id ?? "",
    data?.dossier?.created_by ?? "",
    ...(data?.membres ?? []).map((m) => m.user_id),
    ...(data?.fichiers ?? []).map((f) => f.uploaded_by ?? ""),
  ]);

  if (error) return <Card className="p-6 text-sm text-destructive">Erreur : {errMsg(error)}</Card>;
  if (isLoading || !user) return <Card className="p-6 text-sm text-muted-foreground">Chargement…</Card>;
  if (!data?.dossier) return <Card className="p-6 text-sm">Dossier introuvable ou accès non autorisé.</Card>;

  const d = data.dossier;
  const membre = data.membres.find((m) => m.user_id === user.id);
  const ctx: FicheCtx = {
    dossier: d, etapes: data.etapes, documents: data.documents, fichiers: data.fichiers, membres: data.membres,
    pieceTypes: data.pieceTypes, profiles, staff, uid: user.id, isAdmin: isDirectionOrAdmin,
    canWrite: !d.archived_at && (isDirectionOrAdmin || d.responsable_id === user.id || membre?.role === "collaborateur"),
  };
  return <Fiche ctx={ctx} parent={data.parent} enfants={data.enfants} />;
}

function Fiche({ ctx, parent, enfants }: { ctx: FicheCtx; parent: Pick<PcDossier, "id" | "titre"> | null; enfants: Pick<PcDossier, "id" | "titre" | "type">[] }) {
  const d = ctx.dossier;
  const refresh = useFicheRefresh(d.id);
  const state = useMemo(() => dossierState(d, ctx.etapes, ctx.documents), [d, ctx.etapes, ctx.documents]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [edofOpen, setEdofOpen] = useState(false);
  const canChangeResponsable = !d.archived_at && (ctx.isAdmin || d.responsable_id === ctx.uid);

  const update = async (patch: Partial<PcDossier>, ok?: string) => {
    const { error } = await db.from("pc_dossiers").update(patch).eq("id", d.id);
    if (error) return toast.error(errMsg(error));
    if (ok) toast.success(ok);
    refresh();
  };

  const toggleArchive = () => {
    setArchiveOpen(false);
    update(d.archived_at ? { archived_at: null, archived_by: null } : { archived_at: new Date().toISOString(), archived_by: ctx.uid },
      d.archived_at ? "Dossier désarchivé" : "Dossier archivé");
  };

  const parcoursTermine = state.statut === "termine" && ctx.etapes.length > 0;

  return (
    <div className="space-y-4">
      <Link to="/pole-certification" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Pôle Certification &amp; EDOF
      </Link>

      {d.archived_at && (
        <Card className="p-3 flex items-center gap-2 text-sm bg-muted">
          <Lock className="h-4 w-4" /> Dossier archivé le {frDate(d.archived_at)} — consultable, non modifiable.
        </Card>
      )}
      {!d.archived_at && !ctx.canWrite && (
        <Card className="p-3 flex items-center gap-2 text-sm bg-muted"><Lock className="h-4 w-4" /> Accès en lecture seule.</Card>
      )}

      {/* En-tête */}
      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1"><Award className="h-3 w-3" /> {pcTypeLabel(d.type)}</Badge>
              <PcStatusBadge tone={state.tone} />
              {state.etapeCourante && <span className="text-xs text-muted-foreground">Étape {state.etapeCourante.ordre} — {state.etapeCourante.intitule}</span>}
              {state.tentatives > 1 && <Badge variant="outline">Tentative {state.tentatives}</Badge>}
              {state.docsPerimes && <PcStatusBadge tone="refuse" label="Pièce périmée" />}
              {!state.docsPerimes && state.docsBientot && <PcStatusBadge tone="bientot" label="Pièce qui expire bientôt" />}
            </div>
            <InlineText value={d.titre} disabled={!ctx.canWrite} className="font-display text-2xl" required
              onSave={(v) => update({ titre: v })} ariaLabel="Titre du dossier" />
            <p className="text-xs text-muted-foreground">
              Créé le {frDate(d.created_at)} par {personName(ctx.profiles.get(d.created_by))}
              {parent && <> · Issu du dossier <Link to="/pole-certification/$id" params={{ id: parent.id }} className="underline">{parent.titre}</Link></>}
            </p>
            {enfants.length > 0 && (
              <p className="text-xs flex flex-wrap items-center gap-1">
                <Link2 className="h-3 w-3" /> Dossier(s) lié(s) :
                {enfants.map((c) => <Link key={c.id} to="/pole-certification/$id" params={{ id: c.id }} className="underline">{c.titre}</Link>)}
              </p>
            )}
          </div>
          {ctx.isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setArchiveOpen(true)}>
              {d.archived_at ? <><ArchiveRestore className="h-4 w-4 mr-1" /> Désarchiver</> : <><Archive className="h-4 w-4 mr-1" /> Archiver</>}
            </Button>
          )}
        </div>

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Organisme"><InlineText value={d.organisme ?? ""} disabled={!ctx.canWrite} onSave={(v) => update({ organisme: v || null })} ariaLabel="Organisme" /></Field>
          <Field label="Certificateur"><InlineText value={d.certificateur ?? ""} disabled={!ctx.canWrite} onSave={(v) => update({ certificateur: v || null })} ariaLabel="Certificateur" /></Field>
          <Field label="Code RS / RNCP"><InlineText value={d.code_rs ?? ""} disabled={!ctx.canWrite} onSave={(v) => update({ code_rs: v || null })} ariaLabel="Code RS" /></Field>
          <Field label="Date cible">
            <Input type="date" value={d.date_cible ?? ""} disabled={!ctx.canWrite} onChange={(e) => update({ date_cible: e.target.value || null })} />
          </Field>
          <Field label="Responsable">
            <Select value={d.responsable_id} disabled={!canChangeResponsable}
              onValueChange={(v) => update({ responsable_id: v }, "Responsable modifié (noté dans l'historique)")}>
              <SelectTrigger><SelectValue>{personName(ctx.profiles.get(d.responsable_id))}</SelectValue></SelectTrigger>
              <SelectContent>{ctx.staff.map((p) => <SelectItem key={p.id} value={p.id}>{personName(p)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Notes libres">
          <InlineText multiline value={d.notes ?? ""} disabled={!ctx.canWrite} onSave={(v) => update({ notes: v || null }, "Notes enregistrées")} ariaLabel="Notes" />
        </Field>
      </Card>

      {parcoursTermine && d.type === "certificateur" && enfants.length === 0 && !d.archived_at && (
        <Card className="p-4 flex flex-wrap items-center justify-between gap-3 border-green-500/40 bg-green-500/5">
          <div>
            <p className="font-medium">Parcours terminé : RS confirmé.</p>
            <p className="text-sm text-muted-foreground">Créer le dossier EDOF lié pour référencer la formation auprès de la Caisse des Dépôts ?</p>
          </div>
          <Button onClick={() => setEdofOpen(true)}>Créer le dossier EDOF lié</Button>
        </Card>
      )}
      {parcoursTermine && d.type === "edof" && !d.archived_at && ctx.isAdmin && (
        <Card className="p-4 flex flex-wrap items-center justify-between gap-3 border-green-500/40 bg-green-500/5">
          <p className="font-medium">Parcours EDOF terminé.</p>
          <Button variant="outline" onClick={() => setArchiveOpen(true)}><Archive className="h-4 w-4 mr-1" /> Archiver le dossier</Button>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Tabs defaultValue="etapes" className="min-w-0">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="etapes">Étapes</TabsTrigger>
            <TabsTrigger value="pieces">Pièces ({ctx.documents.length})</TabsTrigger>
            <TabsTrigger value="historique">Historique</TabsTrigger>
          </TabsList>
          <TabsContent value="etapes"><FicheEtapes ctx={ctx} /></TabsContent>
          <TabsContent value="pieces"><FicheDocuments ctx={ctx} /></TabsContent>
          <TabsContent value="historique"><FicheJournal ctx={ctx} /></TabsContent>
        </Tabs>
        <div className="space-y-4">
          <FicheMembres ctx={ctx} />
        </div>
      </div>

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{d.archived_at ? "Désarchiver le dossier ?" : "Archiver le dossier ?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {d.archived_at ? "Le dossier redeviendra modifiable." : "Le dossier restera consultable (historique compris) mais ne sera plus modifiable."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={toggleArchive}>{d.archived_at ? "Désarchiver" : "Archiver"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <NewPcDossierDialog open={edofOpen} onOpenChange={setEdofOpen} parent={d} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-1 min-w-0"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}

/** Champ texte enregistré à la sortie du champ. */
function InlineText({ value, onSave, disabled, multiline, className, required, ariaLabel }: {
  value: string; onSave: (v: string) => void; disabled: boolean; multiline?: boolean; className?: string; required?: boolean; ariaLabel: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const t = v.trim();
    if (t === value.trim()) return;
    if (required && !t) return setV(value);
    onSave(t);
  };
  return multiline ? (
    <Textarea rows={3} value={v} disabled={disabled} aria-label={ariaLabel} onChange={(e) => setV(e.target.value)} onBlur={commit} />
  ) : (
    <Input value={v} disabled={disabled} aria-label={ariaLabel} className={className} onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

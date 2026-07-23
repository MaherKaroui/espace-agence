import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import {
  FileCheck2, Upload, Plus, Download, Trash2, Check, X, History, Loader2, Clock, FileWarning, Bell, FileText,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  listQualiopiRequests,
  createQualiopiRequest,
  registerQualiopiDocument,
  reviewQualiopiRequest,
  deleteQualiopiRequest,
  getQualiopiDocumentUrl,
} from "@/lib/qualiopi.functions";
import { sendQualiopiReminder } from "@/lib/qualiopi-notifications.functions";


type Statut = "en_attente" | "deposee" | "validee" | "refusee";

const STATUT_META: Record<Statut, { label: string; cls: string; icon: any }> = {
  en_attente: { label: "En attente", cls: "bg-muted text-muted-foreground", icon: Clock },
  deposee: { label: "Déposée", cls: "bg-primary/15 text-primary", icon: Upload },
  validee: { label: "Validée", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", icon: Check },
  refusee: { label: "Refusée", cls: "bg-destructive/15 text-destructive", icon: X },
};

async function computeSha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function QualiopiRequestsPanel({ dossierId }: { dossierId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listQualiopiRequests);

  const { data, isLoading } = useQuery({
    queryKey: ["qualiopi-requests", dossierId],
    queryFn: () => listFn({ data: { dossierId } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["qualiopi-requests", dossierId] });

  const requests = (data?.requests ?? []) as any[];
  const documents = (data?.documents ?? []) as any[];
  const events = (data?.events ?? []) as any[];
  const indicators = (data?.indicators ?? []) as any[];
  const criteria = (data?.criteria ?? []) as any[];
  const profiles = (data?.profiles ?? []) as any[];

  const profileFor = (uid: string | null) => profiles.find((p) => p.id === uid);
  const displayName = (uid: string | null) => {
    const p = profileFor(uid ?? "");
    return p ? `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email : "Système";
  };

  const stats = useMemo(() => {
    const s = { en_attente: 0, deposee: 0, validee: 0, refusee: 0 };
    requests.forEach((r) => { s[(r.statut as Statut)] = (s[(r.statut as Statut)] ?? 0) + 1; });
    return s;
  }, [requests]);

  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-lg flex items-center gap-2">
            <FileCheck2 className="h-5 w-5 text-primary" />
            Demandes Qualiopi
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pièces justificatives demandées par indicateur (RNQ · 7 critères / 32 indicateurs)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/dossiers/$id/qualiopi-rapport" params={{ id: dossierId }}>
            <Button size="sm" variant="outline">
              <FileText className="h-4 w-4 mr-1" /> Rapport
            </Button>
          </Link>
          <NewRequestDialog
            dossierId={dossierId}
            indicators={indicators}
            criteria={criteria}
            onDone={invalidate}
          />
        </div>
      </div>




      {isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}

      {!isLoading && requests.length === 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          Aucune demande. Créez-en une pour un indicateur Qualiopi.
        </div>
      )}

      {!isLoading && requests.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 mb-4 text-xs">
            {(Object.keys(STATUT_META) as Statut[]).map((s) => (
              <Badge key={s} variant="outline" className={cn("gap-1", STATUT_META[s].cls)}>
                {STATUT_META[s].label} · {stats[s] ?? 0}
              </Badge>
            ))}
          </div>

          <div className="space-y-3">
            {requests.map((r) => {
              const ind = indicators.find((i) => i.id === r.indicator_id);
              const crit = ind ? criteria.find((c) => c.id === ind.criterion_id) : null;
              const docs = documents.filter((d) => d.request_id === r.id).sort((a, b) => b.version - a.version);
              const evts = events.filter((e) => e.request_id === r.id);
              return (
                <RequestCard
                  key={r.id}
                  request={r}
                  indicator={ind}
                  criterion={crit}
                  documents={docs}
                  events={evts}
                  displayName={displayName}
                  onChanged={invalidate}
                />
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

function NewRequestDialog({
  dossierId, indicators, criteria, onDone,
}: { dossierId: string; indicators: any[]; criteria: any[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [indicatorId, setIndicatorId] = useState<string>("");
  const [message, setMessage] = useState("");
  const [dueDate, setDueDate] = useState("");
  const createFn = useServerFn(createQualiopiRequest);

  const create = useMutation({
    mutationFn: () => createFn({
      data: {
        dossierId,
        indicatorId: Number(indicatorId),
        message,
        dueDate: dueDate || null,
      },
    }),
    onSuccess: () => {
      toast.success("Demande créée");
      setOpen(false);
      setIndicatorId("");
      setMessage("");
      setDueDate("");
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nouvelle demande</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouvelle demande Qualiopi</DialogTitle>
          <DialogDescription>Choisir un indicateur du RNQ et décrire la pièce attendue.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Indicateur</Label>
            <Select value={indicatorId} onValueChange={setIndicatorId}>
              <SelectTrigger><SelectValue placeholder="Sélectionner un indicateur…" /></SelectTrigger>
              <SelectContent className="max-h-80">
                {criteria.map((c) => (
                  <div key={c.id}>
                    <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Critère {c.id} — {c.titre}
                    </div>
                    {indicators.filter((i) => i.criterion_id === c.id).map((i) => (
                      <SelectItem key={i.id} value={String(i.id)}>
                        Ind. {i.numero} — {i.libelle_court}
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Message / précisions</Label>
            <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)}
              placeholder="Décrire la pièce justificative attendue…" />
          </div>
          <div>
            <Label>Échéance (optionnelle)</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !indicatorId || message.trim().length < 3}
          >
            {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Créer la demande
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestCard({
  request, indicator, criterion, documents, events, displayName, onChanged,
}: {
  request: any; indicator: any; criterion: any;
  documents: any[]; events: any[]; displayName: (uid: string | null) => string; onChanged: () => void;
}) {
  const { user } = useAuth();
  const statut = (request.statut as Statut) ?? "en_attente";
  const meta = STATUT_META[statut];
  const StatIcon = meta.icon;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [refuseOpen, setRefuseOpen] = useState(false);
  const [refuseMotif, setRefuseMotif] = useState("");
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const registerFn = useServerFn(registerQualiopiDocument);
  const reviewFn = useServerFn(reviewQualiopiRequest);
  const deleteFn = useServerFn(deleteQualiopiRequest);
  const urlFn = useServerFn(getQualiopiDocumentUrl);
  const remindFn = useServerFn(sendQualiopiReminder);

  const remind = useMutation({
    mutationFn: () => remindFn({ data: { requestId: request.id } }),
    onSuccess: () => { toast.success("Relance envoyée"); onChanged(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });


  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    if (file.size > 524288000) {
      toast.error("Fichier trop volumineux (max 500 Mo)");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${request.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("qualiopi-files")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (upErr) throw upErr;
      let sha256: string | undefined;
      try {
        if (file.size <= 100 * 1024 * 1024) sha256 = await computeSha256(file);
      } catch { /* skip hash on error */ }
      await registerFn({
        data: {
          requestId: request.id,
          storagePath: path,
          filename: file.name,
          mimeType: file.type || undefined,
          fileSize: file.size,
          sha256,
        },
      });
      toast.success("Document déposé");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Envoi impossible");
    } finally {
      setUploading(false);
    }
  };

  const validate = useMutation({
    mutationFn: () => reviewFn({ data: { requestId: request.id, decision: "validee" } }),
    onSuccess: () => { toast.success("Pièce validée"); onChanged(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  const refuse = useMutation({
    mutationFn: () => reviewFn({ data: { requestId: request.id, decision: "refusee", motif: refuseMotif } }),
    onSuccess: () => {
      toast.success("Pièce refusée");
      setRefuseOpen(false);
      setRefuseMotif("");
      onChanged();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  const del = useMutation({
    mutationFn: () => deleteFn({ data: { requestId: request.id } }),
    onSuccess: () => { toast.success("Demande supprimée"); onChanged(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  const download = async (docId: string) => {
    try {
      const { url } = await urlFn({ data: { documentId: docId } });
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    }
  };

  const canDelete = user?.id === request.requested_by; // admin/direction handled server-side too

  return (
    <div className="rounded-lg border p-3 sm:p-4 space-y-3 bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {criterion && indicator && (
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Critère {criterion.id} · Indicateur {indicator.numero}
            </div>
          )}
          <div className="font-medium text-sm">{indicator?.libelle_court ?? "Indicateur inconnu"}</div>
          {request.message && (
            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{request.message}</p>
          )}
          <div className="mt-1 text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
            <span>Demandé par {displayName(request.requested_by)}</span>
            <span>· {formatDistanceToNow(new Date(request.created_at), { addSuffix: true, locale: fr })}</span>
            {request.due_date && (
              <span>· Échéance {new Date(request.due_date).toLocaleDateString("fr-FR")}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Badge className={cn("gap-1", meta.cls)}>
            <StatIcon className="h-3 w-3" /> {meta.label}
          </Badge>
          <button
            type="button"
            className="p-1.5 rounded hover:bg-muted text-muted-foreground"
            onClick={() => setHistoryOpen(true)}
            title="Historique"
          >
            <History className="h-3.5 w-3.5" />
          </button>
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button type="button" className="p-1.5 rounded hover:bg-muted text-destructive" title="Supprimer">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Supprimer cette demande ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Les documents déposés seront également supprimés.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction onClick={() => del.mutate()}>Supprimer</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {statut === "refusee" && request.refus_motif && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive flex gap-2">
          <FileWarning className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Motif de refus</div>
            <div className="whitespace-pre-wrap">{request.refus_motif}</div>
          </div>
        </div>
      )}

      {documents.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            Documents déposés ({documents.length})
          </div>
          {documents.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 text-sm rounded-md bg-muted/40 px-2 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="outline" className="text-[10px] shrink-0">v{d.version}</Badge>
                <span className="truncate">{d.filename}</span>
                {d.file_size && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {(d.file_size / (1024 * 1024)).toFixed(2)} Mo
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[10px] text-muted-foreground">
                  par {displayName(d.uploaded_by)}
                </span>
                <button
                  type="button"
                  className="p-1 rounded hover:bg-background text-muted-foreground"
                  onClick={() => download(d.id)}
                  title="Télécharger"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <input
          ref={uploadRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            if (e.target) e.target.value = "";
          }}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => uploadRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
          Déposer un document
        </Button>
        {(statut === "deposee" || statut === "refusee") && (
          <>
            <Button size="sm" variant="default"
              onClick={() => validate.mutate()}
              disabled={validate.isPending}
            >
              <Check className="h-4 w-4 mr-1" /> Valider
            </Button>
            <Dialog open={refuseOpen} onOpenChange={setRefuseOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="destructive">
                  <X className="h-4 w-4 mr-1" /> Refuser
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Refuser la pièce</DialogTitle>
                  <DialogDescription>Le motif de refus est obligatoire.</DialogDescription>
                </DialogHeader>
                <Textarea
                  rows={4}
                  value={refuseMotif}
                  onChange={(e) => setRefuseMotif(e.target.value)}
                  placeholder="Expliquer pourquoi la pièce est refusée…"
                />
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setRefuseOpen(false)}>Annuler</Button>
                  <Button
                    variant="destructive"
                    onClick={() => refuse.mutate()}
                    disabled={refuse.isPending || refuseMotif.trim().length < 3}
                  >
                    {refuse.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Refuser
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
        {statut !== "validee" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => remind.mutate()}
            disabled={remind.isPending}
            title="Envoyer une relance (anti-spam 24h)"
          >
            {remind.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Bell className="h-4 w-4 mr-1" />}
            Relancer
          </Button>
        )}
      </div>


      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Historique</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {events.length === 0 && (
              <p className="text-sm text-muted-foreground">Aucun événement.</p>
            )}
            {events.map((e) => (
              <div key={e.id} className="text-xs border-l-2 border-primary/40 pl-2 py-1">
                <div className="font-medium">{humanAction(e.action)}</div>
                <div className="text-muted-foreground">
                  {displayName(e.actor_id)}
                  {e.actor_role && <> · {e.actor_role}</>}
                  {" · "}
                  {formatDistanceToNow(new Date(e.created_at), { addSuffix: true, locale: fr })}
                </div>
                {e.meta?.motif && (
                  <div className="mt-1 whitespace-pre-wrap text-destructive">Motif : {e.meta.motif}</div>
                )}
                {e.meta?.filename && (
                  <div className="mt-1 text-muted-foreground">
                    {e.meta.filename} (v{e.meta.version})
                  </div>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function humanAction(a: string) {
  switch (a) {
    case "created": return "Demande créée";
    case "document_uploaded": return "Document déposé";
    case "validated": return "Pièce validée";
    case "refused": return "Pièce refusée";
    default: return a;
  }
}

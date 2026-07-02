import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  CheckCircle2, Circle, Download, Upload, RefreshCw, AlertTriangle, XCircle,
  MessageSquare, HelpCircle, HandHelping,
} from "lucide-react";
import { requiredDocsFor, docMatches, type RequiredDoc } from "@/lib/labels";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { cn } from "@/lib/utils";


type Doc = {
  id: string;
  nom: string;
  storage_path: string;
  detected_type?: string | null;
  statut?: string | null;
  commentaire?: string | null;
};

interface Props {
  dossierId: string;
  categorie: string;
  documents: Doc[];
}

const REVIEW_STATUSES = [
  { value: "en_attente", label: "En attente", tone: "muted" as const, icon: Circle },
  { value: "accepte", label: "Accepté", tone: "success" as const, icon: CheckCircle2 },
  { value: "a_corriger", label: "À corriger", tone: "warning" as const, icon: AlertTriangle },
  { value: "refuse", label: "Refusé", tone: "destructive" as const, icon: XCircle },
];

export function reviewStatusMeta(v?: string | null) {
  return REVIEW_STATUSES.find((s) => s.value === v) ?? REVIEW_STATUSES[0];
}

// Statut affiché au client, plus rassurant qu'un enum technique.
// 🟡 À envoyer · 🔵 Envoyé, en attente de vérification · 🟢 Validé · 🔴 À corriger
function friendlyClientStatus(doc: Doc | null) {
  if (!doc) return { label: "À envoyer", dot: "bg-amber-500", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30" };
  const s = doc.statut ?? "en_attente";
  if (s === "accepte") return { label: "Validé", dot: "bg-emerald-500", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" };
  if (s === "a_corriger") return { label: "À corriger", dot: "bg-red-500", cls: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30" };
  if (s === "refuse") return { label: "À corriger", dot: "bg-red-500", cls: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30" };
  return { label: "Envoyé, en attente", dot: "bg-blue-500", cls: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30" };
}

export function RequiredDocuments({ dossierId, categorie, documents }: Props) {
  const { isAdmin } = useRole();
  const requis = requiredDocsFor(categorie);
  if (requis.length === 0) return null;

  const items = requis.map((r) => {
    const found = documents.find((d) => docMatches(d, r));
    return { ...r, doc: found ?? null };
  });

  const done = items.filter((i) => i.doc && i.doc.statut === "accepte").length;
  const missing = items.filter((i) => !i.doc).length;
  const toFix = items.filter((i) => i.doc && (i.doc.statut === "refuse" || i.doc.statut === "a_corriger")).length;

  const title = isAdmin ? "Documents requis" : "Documents à envoyer";
  const subtitle = isAdmin
    ? `${done}/${items.length} validés${missing ? ` · ${missing} manquant${missing > 1 ? "s" : ""}` : ""}${toFix ? ` · ${toFix} à corriger` : ""}`
    : missing === 0 && toFix === 0
    ? "Tous vos documents ont été envoyés — l'agence vérifie."
    : `Il vous reste ${missing + toFix} document${(missing + toFix) > 1 ? "s" : ""} à envoyer.`;

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h2 className="font-display text-xl">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
      </div>
      <ul className="divide-y">
        {items.map((it) => (
          <RequiredRow key={it.key} dossierId={dossierId} req={it} doc={it.doc} />
        ))}
      </ul>
      {!isAdmin && (
        <p className="text-xs text-muted-foreground mt-4">
          Formats acceptés : PDF, JPG, PNG. Une photo prise avec votre téléphone fonctionne aussi.
        </p>
      )}
    </Card>
  );
}

function RequiredRow({
  dossierId,
  req,
  doc,
}: {
  dossierId: string;
  req: RequiredDoc;
  doc: Doc | null;
}) {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const nav = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const [busy, setBusy] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [uploadDialog, setUploadDialog] = useState(false);
  const [hintDialog, setHintDialog] = useState(false);

  // Ouvre la boîte de dépôt quand l'utilisateur clique sur le CTA « Ajouter mon … »
  // depuis la carte « Prochaine action ».
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (!detail || detail.key !== req.key) return;
      setUploadDialog(true);
      rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    window.addEventListener("required-doc-upload", onOpen as EventListener);
    return () => window.removeEventListener("required-doc-upload", onOpen as EventListener);
  }, [req.key]);


  const friendly = friendlyClientStatus(doc);
  const adminMeta = reviewStatusMeta(doc?.statut);
  const AdminIcon = doc ? adminMeta.icon : Circle;

  const download = async () => {
    if (!doc) return;
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 60, { download: doc.nom });
    if (error) return toast.error(error.message);
    await supabase.rpc("log_document_download", { _document_id: doc.id });
    window.open(data.signedUrl, "_blank");
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setBusy(true);
      if (doc) {
        await supabase.storage.from("documents").remove([doc.storage_path]);
        await supabase.from("documents").delete().eq("id", doc.id);
      }
      const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "bin";
      const renamed = `${req.key}.${ext}`;
      const path = `${dossierId}/${crypto.randomUUID()}-${renamed}`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) throw upErr;
      const { error } = await supabase.from("documents").insert({
        dossier_id: dossierId,
        uploader_id: user!.id,
        nom: renamed,
        storage_path: path,
        taille: file.size,
        mime_type: file.type,
        from_agence: isAdmin,
        detected_type: req.key,
        statut: "en_attente",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(doc ? "Document remplacé — l'agence va le vérifier" : "Merci ! L'agence va vérifier votre document");
      qc.invalidateQueries({ queryKey: ["documents", dossierId] });
      setUploadDialog(false);
    },
    onError: (e: any) => toast.error(e.message),
    onSettled: () => setBusy(false),
  });

  const setStatus = useMutation({
    mutationFn: async (patch: { statut?: string; commentaire?: string }) => {
      if (!doc) return;
      const { error } = await supabase.from("documents").update(patch).eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Revue enregistrée");
      qc.invalidateQueries({ queryKey: ["documents", dossierId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) upload.mutate(f);
    e.target.value = "";
  };

  const askAgence = () => {
    try {
      sessionStorage.setItem(
        "chat-prefill",
        `Bonjour, je n'ai pas le document suivant : ${req.label}. Pouvez-vous m'aider ?`,
      );
    } catch {}
    nav({ to: "/messages" });
  };

  const badgeClass: Record<string, string> = {
    success: "bg-success/15 text-success border-success/20",
    warning: "bg-warning/15 text-warning-foreground border-warning/30",
    destructive: "bg-destructive/15 text-destructive border-destructive/20",
    muted: "bg-muted text-muted-foreground border-border",
  };
  const toneClass: Record<string, string> = {
    success: "text-success",
    warning: "text-warning-foreground",
    destructive: "text-destructive",
    muted: "text-muted-foreground",
  };

  return (
    <li ref={rowRef} className="py-4 text-sm">

      <div className="flex flex-wrap items-start gap-3">
        {isAdmin ? (
          <AdminIcon className={cn("h-5 w-5 shrink-0 mt-0.5", doc ? toneClass[adminMeta.tone] : "text-muted-foreground")} />
        ) : (
          <span className={cn("h-3 w-3 rounded-full shrink-0 mt-1.5", friendly.dot)} aria-hidden />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{req.label}</span>
            {isAdmin && doc ? (
              <Badge variant="outline" className={cn("font-medium", badgeClass[adminMeta.tone])}>
                {adminMeta.label}
              </Badge>
            ) : (
              <Badge variant="outline" className={cn("font-medium", friendly.cls)}>
                {friendly.label}
              </Badge>
            )}
            {!isAdmin && req.hint && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs gap-1"
                onClick={() => setHintDialog(true)}
              >
                <HelpCircle className="h-3.5 w-3.5" />
                C'est quoi ce document&nbsp;?
              </Button>
            )}
          </div>


          {!isAdmin && !doc && req.hint && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{req.hint}</p>
          )}

          {doc && <div className="text-xs text-muted-foreground mt-1 truncate">Fichier envoyé : {doc.nom}</div>}

          {doc?.commentaire && !isAdmin && (
            <div className="mt-2 text-xs bg-muted/50 rounded p-2 border-l-2 border-warning">
              <span className="font-medium">Commentaire de l'agence : </span>{doc.commentaire}
            </div>
          )}
        </div>

        <input ref={fileInput} type="file" hidden onChange={onPick} />

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {doc ? (
            <>
              <Button size="sm" variant="outline" onClick={download} title="Télécharger">
                <Download className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant={isAdmin ? "ghost" : "outline"}
                onClick={() => (isAdmin ? fileInput.current?.click() : setUploadDialog(true))}
                disabled={busy}
                title="Remplacer"
              >
                <RefreshCw className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">{isAdmin ? "" : "Remplacer"}</span>
              </Button>
              {isAdmin && (
                <Button size="sm" variant="ghost" onClick={() => setShowComment((v) => !v)} title="Revue">
                  <MessageSquare className="h-4 w-4" />
                </Button>
              )}
            </>
          ) : isAdmin ? (
            <Button size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
              <Upload className="h-4 w-4 mr-1" /> Déposer
            </Button>
          ) : (
            <>
              <Button size="sm" onClick={() => setUploadDialog(true)} disabled={busy}>
                <Upload className="h-4 w-4 mr-1" /> Ajouter un fichier
              </Button>
              <Button size="sm" variant="ghost" onClick={askAgence} title="Je ne l'ai pas">
                <HandHelping className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Je ne l'ai pas</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {isAdmin && doc && showComment && (
        <div className="mt-3 ml-8 grid gap-2 sm:grid-cols-[180px_1fr] items-start">
          <Select
            defaultValue={doc.statut ?? "en_attente"}
            onValueChange={(v) => setStatus.mutate({ statut: v })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {REVIEW_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Textarea
            rows={2}
            placeholder="Commentaire visible par le client (ex : KBIS trop ancien, à renvoyer récent de moins de 3 mois)"
            defaultValue={doc.commentaire ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (doc.commentaire ?? "")) setStatus.mutate({ commentaire: v || undefined });
            }}
          />
        </div>
      )}

      {!isAdmin && (
        <Dialog open={uploadDialog} onOpenChange={setUploadDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Vous allez envoyer : {req.label}</DialogTitle>
              <DialogDescription className="space-y-2 pt-2">
                <span className="block">Formats acceptés : <strong>PDF, JPG, PNG</strong>.</span>
                <span className="block">Si vous avez une photo prise avec votre téléphone, ça marche aussi.</span>
                {req.hint && <span className="block text-xs pt-2 border-t mt-2">{req.hint}</span>}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="ghost" onClick={() => { setUploadDialog(false); askAgence(); }}>
                Je n'ai pas ce document
              </Button>
              <Button onClick={() => fileInput.current?.click()} disabled={busy}>
                <Upload className="h-4 w-4 mr-1" />
                {busy ? "Envoi…" : "Choisir un fichier"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </li>
  );
}

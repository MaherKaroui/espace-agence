import { useEffect, useRef, useState } from "react";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { CheckCircle2, Circle, Download, Upload, RefreshCw, HelpCircle } from "lucide-react";
import { requiredDocsFor, docMatches, type RequiredDoc } from "@/lib/labels";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { cn } from "@/lib/utils";
import { notifyTeamDocumentDepose } from "@/lib/email/notify-team";
import { useServerFn } from "@tanstack/react-start";
import { autoFileDocumentToDrive } from "@/lib/drive-auto.functions";

type Doc = {
  id: string;
  nom: string;
  storage_path: string | null;
  detected_type?: string | null;
};

interface Props {
  dossierId: string;
  categorie: string;
  documents: Doc[];
}

export function RequiredDocuments({ dossierId, categorie, documents }: Props) {
  const { isStaff: isAdmin } = useRole();
  const requis = requiredDocsFor(categorie);
  if (requis.length === 0) return null;

  const items = requis.map((r) => {
    const found = documents.find((d) => docMatches(d, r));
    return { ...r, doc: found ?? null };
  });

  const received = items.filter((i) => i.doc).length;
  const missing = items.length - received;

  const title = isAdmin ? "Documents requis" : "Documents à envoyer";
  const subtitle = isAdmin
    ? `${received}/${items.length} reçus${missing ? ` · ${missing} manquant${missing > 1 ? "s" : ""}` : ""}`
    : missing === 0
      ? "Tous vos documents ont bien été envoyés."
      : `Il vous reste ${missing} document${missing > 1 ? "s" : ""} à envoyer.`;

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
  const { isStaff: isAdmin } = useRole();
  const qc = useQueryClient();

  const fileInput = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const [busy, setBusy] = useState(false);
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

  const download = async () => {
    if (!doc || !doc.storage_path) return;
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 60, { download: doc.nom });
    if (error) return toast.error(error.message);
    await supabase.rpc("log_document_download", { _document_id: doc.id });
    window.open(data.signedUrl, "_blank");
  };

  const autoFileDrive = useServerFn(autoFileDocumentToDrive);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setBusy(true);
      if (doc) {
        if (doc.storage_path) {
          await supabase.storage.from("documents").remove([doc.storage_path]);
        }
        await supabase.from("documents").delete().eq("id", doc.id);
      }
      const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "bin";
      const renamed = `${req.key}.${ext}`;
      const path = `${dossierId}/${crypto.randomUUID()}-${renamed}`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) throw upErr;
      const { data: inserted, error } = await supabase.from("documents").insert({
        dossier_id: dossierId,
        uploader_id: user!.id,
        nom: renamed,
        storage_path: path,
        taille: file.size,
        mime_type: file.type,
        from_agence: isAdmin,
        detected_type: req.key,
      }).select("id").single();
      if (error) throw error;
      // Classement automatique dans le Drive de l'agence (non bloquant)
      if (inserted?.id) {
        autoFileDrive({ data: { documentId: inserted.id } }).catch((e: unknown) =>
          console.warn("Classement Drive échoué", e),
        );
      }
      // Notifier l'équipe si le dépôt vient du client
      if (!isAdmin) {
        try { notifyTeamDocumentDepose(dossierId, renamed); } catch { /* silencieux */ }
      }
    },
    onSuccess: () => {
      toast.success(doc ? "Document remplacé" : "Document envoyé — merci !");
      qc.invalidateQueries({ queryKey: ["documents", dossierId] });
      setUploadDialog(false);
    },
    onError: (e: any) => toast.error(e.message),
    onSettled: () => setBusy(false),
  });

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) upload.mutate(f);
    e.target.value = "";
  };

  return (
    <li ref={rowRef} className="py-4 text-sm">
      <div className="flex flex-wrap items-start gap-3">
        {doc ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5 text-success" />
        ) : (
          <Circle className="h-5 w-5 shrink-0 mt-0.5 text-muted-foreground" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{req.label}</span>
            <Badge
              variant="outline"
              className={cn(
                "font-medium",
                doc
                  ? "bg-success/15 text-success border-success/20"
                  : "bg-muted text-muted-foreground border-border",
              )}
            >
              {doc ? "Reçu" : "À envoyer"}
            </Badge>
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

          {doc && <div className="text-xs text-muted-foreground mt-1 truncate">Fichier : {doc.nom}</div>}
        </div>

        <input ref={fileInput} type="file" hidden onChange={onPick} />

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {doc ? (
            <>
              {doc.storage_path && (
                <Button size="sm" variant="outline" onClick={download} title="Télécharger">
                  <Download className="h-4 w-4" />
                </Button>
              )}
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
            </>
          ) : isAdmin ? (
            <Button size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
              <Upload className="h-4 w-4 mr-1" /> Déposer
            </Button>
          ) : (
            <Button size="sm" onClick={() => setUploadDialog(true)} disabled={busy}>
              <Upload className="h-4 w-4 mr-1" /> Ajouter un fichier
            </Button>
          )}
        </div>
      </div>

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
            <DialogFooter>
              <Button onClick={() => fileInput.current?.click()} disabled={busy}>
                <Upload className="h-4 w-4 mr-1" />
                {busy ? "Envoi…" : "Choisir un fichier"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {!isAdmin && req.hint && (
        <Dialog open={hintDialog} onOpenChange={setHintDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{req.label}</DialogTitle>
              <DialogDescription className="pt-2 text-sm leading-relaxed">
                {req.hint}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setHintDialog(false)}>J'ai compris</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </li>
  );
}

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, Download, Upload, RefreshCw } from "lucide-react";
import { requiredDocsFor, docMatches, categorieLabel, type RequiredDoc } from "@/lib/labels";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";

type Doc = {
  id: string;
  nom: string;
  storage_path: string;
  detected_type?: string | null;
};

interface Props {
  dossierId: string;
  categorie: string;
  documents: Doc[];
}

export function RequiredDocuments({ dossierId, categorie, documents }: Props) {
  const requis = requiredDocsFor(categorie);
  if (requis.length === 0) return null;

  const items = requis.map((r) => {
    const found = documents.find((d) => docMatches(d, r));
    return { ...r, doc: found ?? null };
  });

  const done = items.filter((i) => i.doc).length;
  const missing = items.length - done;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-display text-xl">Documents requis</h2>
          <p className="text-sm text-muted-foreground">
            {categorieLabel(categorie)} — {done}/{items.length} fournis
            {missing > 0 && <span className="text-warning"> · {missing} manquant{missing > 1 ? "s" : ""}</span>}
          </p>
        </div>
      </div>
      <ul className="divide-y">
        {items.map((it) => (
          <RequiredRow key={it.key} dossierId={dossierId} req={it} doc={it.doc} />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground mt-4">
        Astuce : nommez vos fichiers avec le mot-clé correspondant (ex. « kbis.pdf », « bail.pdf »)
        pour que la reconnaissance soit automatique.
      </p>
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
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    if (!doc) return;
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 60);
    if (error) return toast.error(error.message);
    await supabase.rpc("log_document_download", { _document_id: doc.id });
    window.open(data.signedUrl, "_blank");
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setBusy(true);
      // Si un doc existe déjà, supprimer l'ancien avant
      if (doc) {
        await supabase.storage.from("documents").remove([doc.storage_path]);
        await supabase.from("documents").delete().eq("id", doc.id);
      }
      // Renommer le fichier avec la clé du document requis (ex: kbis.pdf)
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
      });
      if (error) throw error;
    },

    onSuccess: () => {
      toast.success(doc ? "Document remplacé" : "Document ajouté");
      qc.invalidateQueries({ queryKey: ["documents", dossierId] });
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
    <li className="py-3 flex items-center gap-3 text-sm">
      {doc ? (
        <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
      ) : (
        <Circle className="h-5 w-5 text-muted-foreground shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className={doc ? "text-foreground" : "text-muted-foreground"}>{req.label}</div>
        {doc && <div className="text-xs text-muted-foreground truncate">{doc.nom}</div>}
      </div>
      <input ref={fileInput} type="file" hidden onChange={onPick} />
      {doc ? (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={download}>
            <Download className="h-4 w-4" /> Télécharger
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()} disabled={busy}>
            <RefreshCw className="h-4 w-4" /> Remplacer
          </Button>
        </div>
      ) : (
        <Button size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
          <Upload className="h-4 w-4" /> Déposer
        </Button>
      )}
    </li>
  );
}

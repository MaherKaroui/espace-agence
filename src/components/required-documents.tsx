import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Circle, Download, Upload, RefreshCw, AlertTriangle, XCircle, MessageSquare } from "lucide-react";
import { requiredDocsFor, docMatches, categorieLabel, type RequiredDoc } from "@/lib/labels";
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

export function RequiredDocuments({ dossierId, categorie, documents }: Props) {
  const requis = requiredDocsFor(categorie);
  if (requis.length === 0) return null;

  const items = requis.map((r) => {
    const found = documents.find((d) => docMatches(d, r));
    return { ...r, doc: found ?? null };
  });

  const done = items.filter((i) => i.doc && i.doc.statut === "accepte").length;
  const pending = items.filter((i) => i.doc && (!i.doc.statut || i.doc.statut === "en_attente")).length;
  const problems = items.filter((i) => i.doc && (i.doc.statut === "refuse" || i.doc.statut === "a_corriger")).length;
  const missing = items.length - items.filter((i) => i.doc).length;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-display text-xl">Documents requis</h2>
          <p className="text-sm text-muted-foreground">
            {categorieLabel(categorie)} — {done}/{items.length} validés
            {pending > 0 && <span> · {pending} en attente</span>}
            {problems > 0 && <span className="text-destructive"> · {problems} à corriger</span>}
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
  const [showComment, setShowComment] = useState(false);

  const meta = reviewStatusMeta(doc?.statut);
  const Icon = doc ? meta.icon : Circle;

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
      toast.success(doc ? "Document remplacé — en attente de revue" : "Document ajouté — en attente de revue");
      qc.invalidateQueries({ queryKey: ["documents", dossierId] });
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

  const toneClass: Record<string, string> = {
    success: "text-success",
    warning: "text-warning-foreground",
    destructive: "text-destructive",
    muted: "text-muted-foreground",
  };
  const badgeClass: Record<string, string> = {
    success: "bg-success/15 text-success border-success/20",
    warning: "bg-warning/15 text-warning-foreground border-warning/30",
    destructive: "bg-destructive/15 text-destructive border-destructive/20",
    muted: "bg-muted text-muted-foreground border-border",
  };

  return (
    <li className="py-3 text-sm">
      <div className="flex items-center gap-3">
        <Icon className={cn("h-5 w-5 shrink-0", doc ? toneClass[meta.tone] : "text-muted-foreground")} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={doc ? "text-foreground" : "text-muted-foreground"}>{req.label}</span>
            {doc && (
              <Badge variant="outline" className={cn("font-medium", badgeClass[meta.tone])}>
                {meta.label}
              </Badge>
            )}
          </div>
          {doc && <div className="text-xs text-muted-foreground truncate">{doc.nom}</div>}
          {doc?.commentaire && !isAdmin && (
            <div className="mt-1 text-xs bg-muted/50 rounded p-2 border-l-2 border-warning">
              <span className="font-medium">Commentaire agence : </span>{doc.commentaire}
            </div>
          )}
        </div>
        <input ref={fileInput} type="file" hidden onChange={onPick} />
        {doc ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={download} title="Télécharger">
              <Download className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()} disabled={busy} title="Remplacer">
              <RefreshCw className="h-4 w-4" />
            </Button>
            {isAdmin && (
              <Button size="sm" variant="ghost" onClick={() => setShowComment((v) => !v)} title="Revue">
                <MessageSquare className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : (
          <Button size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
            <Upload className="h-4 w-4 mr-1" /> Déposer
          </Button>
        )}
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
    </li>
  );
}

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Paperclip, Download, Trash2, Eye, Loader2 } from "lucide-react";

const MAX_SIZE = 20 * 1024 * 1024; // 20 Mo

const ALLOWED_EXT = [
  "pdf", "doc", "docx", "xls", "xlsx", "csv", "txt", "rtf", "odt", "ods",
  "png", "jpg", "jpeg", "webp", "gif", "heic", "ppt", "pptx", "zip",
];

const fmtSize = (n: number | null) => {
  if (!n) return "—";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function AgencyTaskAttachments({ taskId }: { taskId: string }) {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: files = [] } = useQuery({
    queryKey: ["agency-task-attachments", taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agency_task_attachments")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const ids = Array.from(new Set((data ?? []).map((f) => f.uploaded_by)));
      const profs = ids.length
        ? (await supabase.from("profiles").select("id, nom, prenom, email").in("id", ids)).data ?? []
        : [];
      const m = new Map(profs.map((p) => [p.id, `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || p.id]));
      return (data ?? []).map((f) => ({ ...f, author: m.get(f.uploaded_by) ?? "—" }));
    },
  });

  const upload = async (list: FileList | null) => {
    if (!list?.length || !user) return;
    setUploading(true);
    try {
      for (const file of Array.from(list)) {
        const ext = (file.name.split(".").pop() ?? "").toLowerCase();
        if (!ALLOWED_EXT.includes(ext)) {
          toast.error(`Type de fichier non autorisé : ${file.name}`);
          continue;
        }
        if (file.size > MAX_SIZE) {
          toast.error(`${file.name} dépasse 20 Mo`);
          continue;
        }
        const exists = files.some((f) => f.filename === file.name && Number(f.file_size) === file.size);
        if (exists) {
          toast.info(`${file.name} est déjà joint à cette tâche`);
          continue;
        }
        const safe = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${taskId}/${Date.now()}-${safe}`;
        const { error: upErr } = await supabase.storage.from("task-files").upload(path, file, {
          contentType: file.type || undefined,
        });
        if (upErr) throw upErr;
        const { error } = await supabase.from("agency_task_attachments").insert({
          task_id: taskId,
          uploaded_by: user.id,
          storage_path: path,
          filename: file.name,
          mime_type: file.type || null,
          file_size: file.size,
        });
        if (error) throw error;
      }
      toast.success("Pièce(s) jointe(s) ajoutée(s)");
      qc.invalidateQueries({ queryKey: ["agency-task-attachments", taskId] });
    } catch (e: any) {
      toast.error(e.message ?? "Échec de l'envoi du fichier");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const openFile = async (path: string, download?: string) => {
    const { data, error } = await supabase.storage
      .from("task-files")
      .createSignedUrl(path, 3600, download ? { download } : undefined);
    if (error || !data?.signedUrl) {
      toast.error("Fichier introuvable");
      return;
    }
    window.open(data.signedUrl, "_blank", "noreferrer");
  };

  const remove = useMutation({
    mutationFn: async (f: { id: string; storage_path: string }) => {
      await supabase.storage.from("task-files").remove([f.storage_path]);
      const { error } = await supabase.from("agency_task_attachments").delete().eq("id", f.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pièce jointe supprimée");
      qc.invalidateQueries({ queryKey: ["agency-task-attachments", taskId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  return (
    <div className="space-y-2 pt-2 border-t">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium flex items-center gap-1">
          <Paperclip className="h-4 w-4" /> Pièces jointes ({files.length})
        </div>
        <Button size="sm" variant="outline" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ajouter des fichiers"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Images, PDF, Word, Excel, texte… 20 Mo maximum par fichier.
      </p>

      {files.length === 0 && <div className="text-xs text-muted-foreground">Aucune pièce jointe.</div>}

      <div className="space-y-2">
        {files.map((f) => {
          const canDelete = isAdmin || f.uploaded_by === user?.id;
          return (
            <Card key={f.id} className="p-2 flex items-center gap-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{f.filename}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {fmtSize(f.file_size)} · {f.mime_type || "fichier"} · {fmtDate(f.created_at)} · {f.author}
                </div>
              </div>
              <Button size="icon" variant="ghost" title="Aperçu" onClick={() => openFile(f.storage_path)}>
                <Eye className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" title="Télécharger" onClick={() => openFile(f.storage_path, f.filename)}>
                <Download className="h-4 w-4" />
              </Button>
              {canDelete && (
                <Button
                  size="icon"
                  variant="ghost"
                  title="Supprimer"
                  onClick={() => remove.mutate({ id: f.id, storage_path: f.storage_path })}
                  disabled={remove.isPending}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

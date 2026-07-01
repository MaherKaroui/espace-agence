import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { categorieLabel, STATUTS } from "@/lib/labels";
import { ArrowLeft, Upload, Download, Trash2, FileText, Image as ImageIcon, Film } from "lucide-react";
import { TasksPanel } from "@/components/tasks-panel";
import { VideoPlayer, isVideoMime } from "@/components/video-player";
import { RelanceButton } from "@/components/relance-button";

import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/dossiers/$id")({
  head: () => ({ meta: [{ title: "Dossier" }] }),
  component: DossierDetail,
});

function DossierDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const nav = useNavigate();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: dossier, isLoading } = useQuery({
    queryKey: ["dossier", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("dossiers").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: documents = [] } = useQuery({
    queryKey: ["documents", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("documents").select("*").eq("dossier_id", id).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const path = `${id}/${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
      if (upErr) throw upErr;
      const { error } = await supabase.from("documents").insert({
        dossier_id: id,
        uploader_id: user!.id,
        nom: file.name,
        storage_path: path,
        taille: file.size,
        mime_type: file.type,
        from_agence: isAdmin,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Document ajouté");
      qc.invalidateQueries({ queryKey: ["documents", id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (doc: any) => {
      await supabase.storage.from("documents").remove([doc.storage_path]);
      const { error } = await supabase.from("documents").delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Supprimé"); qc.invalidateQueries({ queryKey: ["documents", id] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateDossier = useMutation({
    mutationFn: async (patch: any) => {
      const { error } = await supabase.from("dossiers").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Mis à jour"); qc.invalidateQueries({ queryKey: ["dossier", id] }); qc.invalidateQueries({ queryKey: ["dossiers-mine"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((f) => upload.mutate(f));
    e.target.value = "";
  };

  const downloadDoc = async (doc: any) => {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60);
    if (error) { toast.error(error.message); return; }
    await supabase.rpc("log_document_download", { _document_id: doc.id });
    window.open(data.signedUrl, "_blank");
  };

  if (isLoading) return <div className="p-8 text-muted-foreground">Chargement…</div>;
  if (!dossier) return <div className="p-8">Dossier introuvable.</div>;

  return (
    <div className="space-y-6">
      <button onClick={() => nav({ to: "/dossiers" })} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ArrowLeft className="h-4 w-4" /> Retour aux dossiers
      </button>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs uppercase tracking-wider text-gold font-medium">{categorieLabel(dossier.categorie)}</span>
              <StatusBadge statut={dossier.statut} />
            </div>
            <h1 className="font-display text-2xl">{dossier.titre}</h1>
            {dossier.description && <p className="text-muted-foreground mt-2">{dossier.description}</p>}
          </div>
          <div className="w-full md:w-64">
            <div className="text-xs text-muted-foreground mb-1">Avancement</div>
            <Progress value={dossier.avancement} />
            <div className="text-sm mt-1">{dossier.avancement}%</div>
          </div>
        </div>

        {isAdmin && (
          <div className="mt-6 grid md:grid-cols-3 gap-3 pt-6 border-t">
            <div>
              <label className="text-xs text-muted-foreground">Statut</label>
              <Select defaultValue={dossier.statut} onValueChange={(v) => updateDossier.mutate({ statut: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Avancement (%)</label>
              <Input type="number" min={0} max={100} defaultValue={dossier.avancement}
                onBlur={(e) => {
                  const v = Math.max(0, Math.min(100, Number(e.target.value)));
                  if (v !== dossier.avancement) updateDossier.mutate({ avancement: v });
                }} />
            </div>
            <div className="md:col-span-3">
              <label className="text-xs text-muted-foreground">Commentaire de l'agence</label>
              <Textarea defaultValue={dossier.commentaire_agence ?? ""}
                onBlur={(e) => updateDossier.mutate({ commentaire_agence: e.target.value })} rows={2} />
            </div>
          </div>
        )}

        {!isAdmin && dossier.commentaire_agence && (
          <div className="mt-6 pt-6 border-t">
            <div className="text-xs text-muted-foreground mb-1">Commentaire de l'agence</div>
            <p className="text-sm">{dossier.commentaire_agence}</p>
          </div>
        )}
      </Card>

      <TasksPanel dossierId={id} />

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl">Documents ({documents.length})</h2>
          <div>
            <input ref={fileInput} type="file" multiple hidden onChange={handleUpload} />
            <Button onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
              <Upload className="h-4 w-4 mr-2" /> Déposer un document
            </Button>
          </div>
        </div>

        {documents.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">Aucun document pour l'instant.</div>
        ) : (
          <div className="divide-y">
            {documents.map((d) => {
              const isImg = d.mime_type?.startsWith("image/");
              const isVid = isVideoMime(d.mime_type);
              return (
                <div key={d.id} className="py-3 flex items-center gap-3">
                  {isVid ? (
                    <VideoPlayer
                      documentId={d.id}
                      storagePath={d.storage_path}
                      fileName={d.nom}
                      thumbnailPath={d.thumbnail_path}
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                      {isImg ? <ImageIcon className="h-5 w-5 text-muted-foreground" /> : <FileText className="h-5 w-5 text-muted-foreground" />}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-1">
                      {isVid && <Film className="h-3.5 w-3.5 text-muted-foreground" />}
                      {d.nom}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {d.from_agence ? "Envoyé par l'agence" : "Déposé par le client"} · {formatDistanceToNow(new Date(d.created_at), { addSuffix: true, locale: fr })}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => downloadDoc(d)}><Download className="h-4 w-4" /></Button>
                  {(isAdmin || d.uploader_id === user?.id) && (
                    <Button size="sm" variant="ghost" onClick={() => del.mutate(d)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  )}
                </div>
              );
            })}

          </div>
        )}
      </Card>
    </div>
  );
}

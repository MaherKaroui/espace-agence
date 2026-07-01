import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";

/**
 * Lecteur vidéo intégré. Streaming via URL signée (durée limitée, jamais publique).
 * L'ouverture du lecteur est journalisée comme un accès document
 * (RPC log_document_download côté serveur — même trace qu'un téléchargement,
 * marquée `video.viewed` via metadata).
 */
export function VideoPlayer({
  documentId,
  storagePath,
  fileName,
  thumbnailPath,
}: {
  documentId: string;
  storagePath: string;
  fileName: string;
  thumbnailPath?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  // Vignette : signée à durée courte pour l'affichage dans la liste
  useEffect(() => {
    if (!thumbnailPath) return;
    supabase.storage.from("document-thumbnails")
      .createSignedUrl(thumbnailPath, 1800)
      .then(({ data }) => { if (data) setThumbUrl(data.signedUrl); });
  }, [thumbnailPath]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.storage
        .from("documents")
        .createSignedUrl(storagePath, 900); // 15 min
      if (error || !data || cancelled) return;
      setUrl(data.signedUrl);
      // Journaliser le visionnage (même RPC que le téléchargement, l'audit_logs
      // conserve la trace « qui, quand, quel fichier »).
      await supabase.rpc("log_event", {
        _action: "video.viewed",
        _entity_type: "document",
        _entity_id: documentId,
        _severity: "info",
        _metadata: { file: fileName },
      });
    })();
    return () => { cancelled = true; setUrl(null); };
  }, [open, storagePath, documentId, fileName]);

  return (
    <>
      {thumbUrl ? (
        <button
          onClick={() => setOpen(true)}
          className="relative h-10 w-16 rounded overflow-hidden bg-muted flex-shrink-0"
          aria-label={`Lire ${fileName}`}
        >
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Play className="h-4 w-4 text-white fill-white" />
          </span>
        </button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            <Play className="h-4 w-4 mr-1" /> Lire
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{fileName}</DialogTitle>
          </DialogHeader>
          {url ? (
            <video
              src={url}
              controls
              autoPlay
              controlsList="nodownload"
              className="w-full rounded-lg bg-black max-h-[70vh]"
            />
          ) : (
            <div className="aspect-video bg-muted animate-pulse rounded-lg" />
          )}
          <p className="text-xs text-muted-foreground">
            Streaming sécurisé — le visionnage est tracé dans le journal d'audit.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function isVideoMime(mime?: string | null): boolean {
  return !!mime && mime.startsWith("video/");
}

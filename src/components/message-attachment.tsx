import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Image as ImageIcon, Download } from "lucide-react";
import { attachmentKind, isPdfAttachment, downloadConversationFile } from "@/lib/conversation-files";

/**
 * Rendu unique d'une pièce jointe dans une bulle de message,
 * partagé par les trois messageries (client, groupe, interne).
 * L'URL signée est mise en cache par react-query (50 min) pour éviter
 * une requête de signature à chaque re-rendu.
 */
export function MessageAttachment({
  bucket,
  path,
  name,
  mime,
  inverse = false,
  showDownload = true,
}: {
  bucket: string;
  path: string;
  name?: string | null;
  mime?: string | null;
  inverse?: boolean;
  showDownload?: boolean;
}) {
  const kind = attachmentKind(name, mime);
  const isPdf = isPdfAttachment(name, mime);

  const { data: url } = useQuery({
    queryKey: ["attachment-url", bucket, path],
    staleTime: 50 * 60 * 1000,
    gcTime: 55 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) throw error ?? new Error("Fichier introuvable");
      return data.signedUrl;
    },
  });

  return (
    <div className="mb-2 space-y-1">
      {kind === "image" && url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={name ?? ""} loading="lazy" className="rounded-lg max-h-64" />
        </a>
      ) : kind === "video" && url ? (
        <video src={url} controls className="rounded-lg max-h-72 w-full" preload="metadata" />
      ) : kind === "audio" && url ? (
        <audio src={url} controls className="w-64 max-w-full" preload="metadata" />
      ) : (
        <a
          href={url || "#"}
          target="_blank"
          rel="noreferrer"
          className={`flex items-center gap-2 rounded-lg p-2 ${inverse ? "bg-white/10" : "bg-muted"}`}
        >
          {isPdf ? <FileText className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
          <span className="text-xs truncate">{name || "Pièce jointe"}</span>
        </a>
      )}
      {showDownload && kind !== "audio" && (
        <button
          type="button"
          onClick={async () => {
            try {
              await downloadConversationFile(bucket, path, name);
            } catch (error: any) {
              toast.error(error?.message || "Fichier introuvable");
            }
          }}
          className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded ${inverse ? "bg-white/10 hover:bg-white/20" : "bg-muted hover:bg-muted/70"}`}
        >
          <Download className="h-3 w-3" /> Télécharger
        </button>
      )}
    </div>
  );
}

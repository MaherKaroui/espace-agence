import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Paperclip, Search, FileText, FileSpreadsheet, File as FileIcon, Play, Download,
  X, ChevronLeft, ChevronRight, CornerUpLeft, Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  type ConversationScope,
  type ConversationFile,
  fetchConversationFiles,
  signPathsInBatch,
  scopeBucket,
  scopeKey,
  isPdfAttachment,
  downloadConversationFile,
  scrollToMessage,
} from "@/lib/conversation-files";

const PAGE_SIZE = 40;

type TabKey = "all" | "media" | "docs" | "audio";

export function ConversationFilesButton({ scope, className }: { scope: ConversationScope; className?: string }) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const trigger = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("h-9 gap-1.5 shrink-0", className)}
      onClick={() => setOpen(true)}
      title="Fichiers et images de la conversation"
    >
      <Paperclip className="h-4 w-4" />
      <span className="hidden sm:inline">Fichiers</span>
    </Button>
  );

  const body = <FilesPanelBody scope={scope} onClose={() => setOpen(false)} />;

  return (
    <>
      {trigger}
      {isMobile ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="h-[85vh] flex flex-col p-0 gap-0">
            <SheetHeader className="p-4 border-b">
              <SheetTitle className="text-base">Fichiers et images de la conversation</SheetTitle>
            </SheetHeader>
            {body}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-3xl h-[80vh] flex flex-col p-0 gap-0">
            <DialogHeader className="p-4 border-b">
              <DialogTitle className="text-base">Fichiers et images de la conversation</DialogTitle>
            </DialogHeader>
            {body}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function FilesPanelBody({ scope, onClose }: { scope: ConversationScope; onClose: () => void }) {
  const bucket = scopeBucket(scope);
  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const { data: files = [], isLoading, isFetching } = useQuery({
    queryKey: ["conversation-files", scopeKey(scope), limit],
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: () => fetchConversationFiles(scope, { limit, offset: 0 }),
  });

  // Signature EN LOT : un seul appel createSignedUrls pour toute la page.
  const { data: urls } = useQuery({
    queryKey: ["conversation-files-urls", bucket, scopeKey(scope), files.map((f) => f.path).join("|")],
    enabled: files.length > 0,
    staleTime: 50 * 60 * 1000,
    gcTime: 55 * 60 * 1000,
    queryFn: () => signPathsInBatch(bucket, files.map((f) => f.path), 3600),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return files.filter((f) => {
      if (q && !f.name.toLowerCase().includes(q)) return false;
      if (tab === "media") return f.kind === "image" || f.kind === "video";
      if (tab === "docs") return f.kind === "document";
      if (tab === "audio") return f.kind === "audio";
      return true;
    });
  }, [files, search, tab]);

  const viewable = useMemo(
    () => filtered.filter((f) => f.kind === "image" || f.kind === "video" || isPdfAttachment(f.name, f.mime)),
    [filtered],
  );

  const goToMessage = (f: ConversationFile) => {
    onClose();
    window.setTimeout(() => {
      if (!scrollToMessage(f.messageId)) toast.info("Message introuvable dans la vue actuelle");
    }, 250);
  };

  const media = filtered.filter((f) => f.kind === "image" || f.kind === "video");
  const showGrid = tab === "media" || (tab === "all" && media.length > 0);

  return (
    <>
      <div className="p-3 sm:p-4 border-b space-y-3">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-9"
            placeholder="Rechercher un fichier par nom…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="w-full grid grid-cols-4 h-9">
            <TabsTrigger value="all" className="text-xs">Tout</TabsTrigger>
            <TabsTrigger value="media" className="text-xs">Images et vidéos</TabsTrigger>
            <TabsTrigger value="docs" className="text-xs">Documents</TabsTrigger>
            <TabsTrigger value="audio" className="text-xs">Vocaux</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
        {isLoading && (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-12">
            Aucun fichier partagé dans cette conversation.
          </p>
        )}

        {showGrid && media.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {media.map((f) => (
              <button
                key={f.messageId + f.path}
                type="button"
                onClick={() => setViewerIndex(viewable.findIndex((v) => v.path === f.path))}
                className="relative aspect-square rounded-lg overflow-hidden bg-muted group"
                title={`${f.name} · ${f.senderName}`}
              >
                {urls?.get(f.path) ? (
                  f.kind === "image" ? (
                    <img src={urls.get(f.path)} alt={f.name} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <video src={urls.get(f.path)} preload="metadata" muted className="h-full w-full object-cover" />
                  )
                ) : (
                  <div className="h-full w-full animate-pulse bg-muted" />
                )}
                {f.kind === "video" && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <Play className="h-6 w-6 text-white fill-white" />
                  </span>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1 text-[10px] text-white text-left truncate">
                  {f.name}
                </span>
              </button>
            ))}
          </div>
        )}

        {filtered
          .filter((f) => (tab === "media" ? false : tab === "all" ? f.kind !== "image" && f.kind !== "video" : true))
          .map((f) => (
            <FileRow
              key={f.messageId + f.path}
              file={f}
              url={urls?.get(f.path)}
              bucket={bucket}
              onOpen={() => {
                const i = viewable.findIndex((v) => v.path === f.path);
                if (i >= 0) setViewerIndex(i);
              }}
              onGoToMessage={() => goToMessage(f)}
            />
          ))}

        {files.length >= limit && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" disabled={isFetching} onClick={() => setLimit((l) => l + PAGE_SIZE)}>
              {isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Charger plus
            </Button>
          </div>
        )}
      </div>

      {viewerIndex !== null && viewable[viewerIndex] && (
        <MediaViewer
          items={viewable}
          index={viewerIndex}
          urls={urls}
          bucket={bucket}
          onIndex={setViewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </>
  );
}

function docIcon(f: ConversationFile) {
  const n = f.name.toLowerCase();
  if (isPdfAttachment(f.name, f.mime)) return FileText;
  if (/\.(xlsx?|csv)$/.test(n)) return FileSpreadsheet;
  if (/\.(docx?|odt|txt|rtf)$/.test(n)) return FileText;
  return FileIcon;
}

function FileRow({
  file,
  url,
  bucket,
  onOpen,
  onGoToMessage,
}: {
  file: ConversationFile;
  url?: string;
  bucket: string;
  onOpen: () => void;
  onGoToMessage: () => void;
}) {
  const Icon = docIcon(file);
  const canView = isPdfAttachment(file.name, file.mime) || file.kind === "image" || file.kind === "video";
  return (
    <div className="flex items-start gap-3 rounded-lg border p-2.5">
      {file.kind === "audio" ? (
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-sm font-medium truncate">{file.name}</div>
          {url ? <audio src={url} controls preload="metadata" className="w-full max-w-xs" /> : null}
          <Meta file={file} />
        </div>
      ) : (
        <>
          <div className="h-9 w-9 rounded bg-muted flex items-center justify-center shrink-0">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={canView ? onOpen : undefined}
              className={cn("text-sm font-medium truncate block text-left w-full", canView && "hover:underline")}
            >
              {file.name}
            </button>
            <Meta file={file} />
          </div>
        </>
      )}
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Aller au message" onClick={onGoToMessage}>
          <CornerUpLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Télécharger"
          onClick={async () => {
            try {
              await downloadConversationFile(bucket, file.path, file.name);
            } catch (e: any) {
              toast.error(e?.message || "Fichier introuvable");
            }
          }}
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function Meta({ file }: { file: ConversationFile }) {
  return (
    <div className="text-[11px] text-muted-foreground truncate">
      {file.senderName} · {format(new Date(file.createdAt), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}
    </div>
  );
}

function MediaViewer({
  items,
  index,
  urls,
  bucket,
  onIndex,
  onClose,
}: {
  items: ConversationFile[];
  index: number;
  urls?: Map<string, string>;
  bucket: string;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const url = urls?.get(item.path);
  const [touchX, setTouchX] = useState<number | null>(null);

  const prev = () => onIndex((index - 1 + items.length) % items.length);
  const next = () => onIndex((index + 1) % items.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const isPdf = isPdfAttachment(item.name, item.mime);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex flex-col"
      onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX === null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 60) (dx > 0 ? prev : next)();
        setTouchX(null);
      }}
    >
      <div className="flex items-start justify-between gap-3 p-3 text-white">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{item.name}</div>
          <div className="text-[11px] opacity-80 truncate">
            {item.senderName} · {format(new Date(item.createdAt), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10"
            title="Télécharger"
            onClick={async () => {
              try {
                await downloadConversationFile(bucket, item.path, item.name);
              } catch (e: any) {
                toast.error(e?.message || "Fichier introuvable");
              }
            }}
          >
            <Download className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" title="Fermer" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center px-2 pb-4">
        {items.length > 1 && (
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 shrink-0" onClick={prev} title="Précédent">
            <ChevronLeft className="h-7 w-7" />
          </Button>
        )}
        <div className="flex-1 h-full flex items-center justify-center min-w-0">
          {!url ? (
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          ) : isPdf ? (
            <iframe src={url} title={item.name} className="w-full h-full rounded-lg bg-white" />
          ) : item.kind === "video" ? (
            <video src={url} controls autoPlay className="max-h-full max-w-full rounded-lg" />
          ) : (
            <img src={url} alt={item.name} className="max-h-full max-w-full object-contain rounded-lg" />
          )}
        </div>
        {items.length > 1 && (
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 shrink-0" onClick={next} title="Suivant">
            <ChevronRight className="h-7 w-7" />
          </Button>
        )}
      </div>
    </div>
  );
}

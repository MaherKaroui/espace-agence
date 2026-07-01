import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createChatFileSignedUrl, downloadChatFileAttachment } from "@/lib/chat-attachments";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Paperclip, Send, Search, FileText, Image as ImageIcon, Trash2, Pencil, X, Mic, Download } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useSwipeReveal } from "@/hooks/use-swipe-reveal";

export function GroupChatWindow({
  conversationId,
  title,
  memberNames,
}: {
  conversationId: string;
  title: string;
  memberNames: Record<string, string>;
}) {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: messages = [] } = useQuery({
    queryKey: ["group-messages", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("group_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);

  const { data: reads = [] } = useQuery({
    queryKey: ["group-message-reads", conversationId, messageIds.length],
    enabled: messageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("group_message_reads")
        .select("*")
        .in("message_id", messageIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const readsByMessage = useMemo(() => {
    const map = new Map<string, { user_id: string; read_at: string }[]>();
    for (const r of reads) {
      const arr = map.get(r.message_id) ?? [];
      arr.push({ user_id: r.user_id, read_at: r.read_at });
      map.set(r.message_id, arr);
    }
    return map;
  }, [reads]);

  const memberCount = Object.keys(memberNames).length;

  useEffect(() => {
    const channel = supabase
      .channel(`group-chat-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_messages", filter: `conversation_id=eq.${conversationId}` },
        () => qc.invalidateQueries({ queryKey: ["group-messages", conversationId] }),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "group_message_reads" },
        () => qc.invalidateQueries({ queryKey: ["group-message-reads", conversationId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, qc]);

  // Mark received messages as read
  useEffect(() => {
    if (!user || messages.length === 0) return;
    const myReadIds = new Set(reads.filter((r) => r.user_id === user.id).map((r) => r.message_id));
    const toMark = messages
      .filter((m) => m.sender_id !== user.id && !m.deleted_at && !myReadIds.has(m.id))
      .map((m) => ({ message_id: m.id, user_id: user.id }));
    if (toMark.length === 0) return;
    supabase.from("group_message_reads").insert(toMark).then(({ error }) => {
      if (error && !error.message.includes("duplicate")) console.error("mark read", error);
    });
  }, [messages, reads, user]);


  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const send = useMutation({
    mutationFn: async ({ content, file }: { content: string; file?: File }) => {
      let attachment_path: string | null = null;
      let attachment_name: string | null = null;
      let attachment_mime: string | null = null;
      if (file) {
        const safeName = file.name
          .normalize("NFKD")
          .replace(/[^\w.\-]+/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_|_$/g, "");
        const path = `${user!.id}/${crypto.randomUUID()}-${safeName || "fichier"}`;
        const { error } = await supabase.storage.from("chat-files").upload(path, file);
        if (error) throw error;
        attachment_path = path; attachment_name = file.name; attachment_mime = file.type;
      }
      const { error } = await supabase.from("group_messages").insert({
        conversation_id: conversationId,
        sender_id: user!.id,
        content: content || null,
        attachment_path, attachment_name, attachment_mime,
      });
      if (error) throw error;
    },
    onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: ["group-messages", conversationId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    send.mutate({ content: text.trim() });
  };

  const sendFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const initialText = text.trim();
    setText("");
    for (let i = 0; i < files.length; i++) {
      try {
        await send.mutateAsync({ content: i === 0 ? initialText : "", file: files[i] });
      } catch { break; }
    }
    if (files.length > 1) toast.success(`${files.length} fichiers envoyés`);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    sendFiles(Array.from(list));
    e.target.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pasted: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) {
          const ext = f.type.split("/")[1] || "png";
          const named = f.name && f.name !== "image.png"
            ? f
            : new File([f], `image-${Date.now()}.${ext}`, { type: f.type });
          pasted.push(named);
        }
      }
    }
    if (pasted.length > 0) {
      e.preventDefault();
      sendFiles(pasted);
    }
  };


  const startRecording = async () => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
      const mime = mimes.find((m) => (window as any).MediaRecorder?.isTypeSupported?.(m)) || "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recordChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) recordChunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = mr.mimeType || "audio/webm";
        const blob = new Blob(recordChunksRef.current, { type });
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `vocal-${Date.now()}.${ext}`, { type });
        send.mutate({ content: "", file });
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
      setRecordSecs(0);
      recordTimerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    } catch (e: any) {
      toast.error("Impossible d'accéder au micro : " + (e?.message ?? "permission refusée"));
    }
  };

  const stopRecording = (cancel = false) => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    if (cancel) mr.ondataavailable = null as any;
    if (cancel) mr.onstop = () => mr.stream.getTracks().forEach((t) => t.stop());
    try { mr.stop(); } catch {}
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    setRecording(false);
    setRecordSecs(0);
    mediaRecorderRef.current = null;
  };

  useEffect(() => () => { if (recordTimerRef.current) clearInterval(recordTimerRef.current); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return messages;
    return messages.filter((m) => m.content?.toLowerCase().includes(search.toLowerCase()));
  }, [messages, search]);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-0">
      <Card className="flex flex-col flex-1 overflow-hidden min-h-0">
        <div className="flex items-center justify-between gap-2 p-3 sm:p-4 border-b">
          <div className="min-w-0 flex-1">
            <div className="font-display text-base sm:text-lg truncate">{title}</div>
            <div className="text-xs text-muted-foreground">Discussion de groupe</div>
          </div>
          <div className="relative shrink-0">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input className="pl-8 h-9 w-32 sm:w-48" placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        <SwipeableList
          filtered={filtered}
          user={user}
          isAdmin={isAdmin}
          memberNames={memberNames}
          memberCount={memberCount}
          readsByMessage={readsByMessage}
          bottomRef={bottomRef}
        />


        <form onSubmit={submit} className="p-3 border-t flex gap-2 items-end bg-background">
          <input ref={fileInput} type="file" hidden multiple onChange={handleFile} />
          <Button type="button" size="icon" variant="ghost" onClick={() => fileInput.current?.click()} disabled={recording}>
            <Paperclip className="h-5 w-5" />
          </Button>
          {recording ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 h-9 rounded-md border bg-red-500/10 text-red-600 text-sm">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                Enregistrement… {String(Math.floor(recordSecs / 60)).padStart(2, "0")}:{String(recordSecs % 60).padStart(2, "0")}
              </div>
              <Button type="button" size="icon" variant="ghost" onClick={() => stopRecording(true)}>
                <X className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon" onClick={() => stopRecording(false)}>
                <Send className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onPaste={handlePaste}
                placeholder="Écrire un message… (Ctrl+V pour coller une image)"
                className="flex-1"
              />

              {text.trim() ? (
                <Button type="submit" size="icon" disabled={send.isPending}><Send className="h-4 w-4" /></Button>
              ) : (
                <Button type="button" size="icon" variant="ghost" onClick={startRecording}>
                  <Mic className="h-5 w-5" />
                </Button>
              )}
            </>
          )}
        </form>
      </Card>
    </div>
  );
}

function SwipeableList({
  filtered,
  user,
  isAdmin,
  memberNames,
  memberCount,
  readsByMessage,
  bottomRef,
}: {
  filtered: any[];
  user: any;
  isAdmin: boolean;
  memberNames: Record<string, string>;
  memberCount: number;
  readsByMessage: Map<string, { user_id: string; read_at: string }[]>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { dragX, dragging, max, containerProps } = useSwipeReveal(120);
  const shift = { transform: `translateX(-${dragX}px)`, transition: dragging ? "none" : "transform 0.25s ease" };

  return (
    <div
      className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3 bg-muted/20 select-none"
      {...containerProps}
    >
      {filtered.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-12">Aucun message. Envoyez le premier !</div>
      )}
      {filtered.map((m) => {
        const isMine = m.sender_id === user?.id;
        const reads = readsByMessage.get(m.id) ?? [];
        const others = reads.filter((r) => r.user_id !== m.sender_id);
        const totalOthers = Math.max(0, memberCount - 1);
        let info: React.ReactNode = null;
        if (isMine) {
          if (others.length === 0) {
            info = <span>✓ Envoyé</span>;
          } else {
            const list = others
              .map((r) => `${memberNames[r.user_id] ?? "—"} — ${format(new Date(r.read_at), "dd/MM HH:mm", { locale: fr })}`)
              .join("\n");
            info = (
              <div className="space-y-0.5">
                <div>✓✓ Vu par {others.length}/{totalOthers}</div>
                <div className="text-[10px] whitespace-pre-line opacity-80">{list}</div>
              </div>
            );
          }
        } else {
          info = <span>Reçu · {format(new Date(m.created_at), "dd/MM HH:mm", { locale: fr })}</span>;
        }
        return (
          <div key={m.id} className="relative">
            <div style={shift}>
              <GroupBubble
                m={m}
                isMine={isMine}
                isAdmin={isAdmin}
                senderName={memberNames[m.sender_id] ?? "—"}
              />
            </div>
            <div
              className="absolute top-0 h-full flex items-center text-[11px] text-muted-foreground pl-2 pointer-events-none"
              style={{ right: `-${max}px`, width: `${max}px`, ...shift, opacity: Math.min(1, dragX / (max * 0.5)) }}
            >
              {info}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

function GroupBubble({ m, isMine, isAdmin, senderName }: { m: any; isMine: boolean; isAdmin: boolean; senderName: string }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(m.content ?? "");
  const isDeleted = !!m.deleted_at;
  const canEdit = isMine && !isDeleted && !!m.content;
  const canDelete = (isMine || isAdmin) && !isDeleted;

  useEffect(() => {
    if (!m.attachment_path || isDeleted) return;
    let active = true;
    setUrl(null);

    createChatFileSignedUrl(m.attachment_path)
      .then((signedUrl) => { if (active) setUrl(signedUrl); })
      .catch((error) => {
        console.error("Signed URL error", error, "path=", m.attachment_path);
        if (active) setUrl(null);
      });

    return () => { active = false; };
  }, [m.attachment_path, m.attachment_name, isDeleted]);

  const nameLower = (m.attachment_name ?? "").toLowerCase();
  const isImg = m.attachment_mime?.startsWith("image/") || /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/.test(nameLower);
  const isPdf = m.attachment_mime === "application/pdf" || nameLower.endsWith(".pdf");
  const isVideo = m.attachment_mime?.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/.test(nameLower);
  const isAudio =
    m.attachment_mime?.startsWith("audio/") ||
    nameLower.startsWith("vocal-") ||
    /\.(webm|ogg|oga|mp3|m4a|wav|aac)$/.test(nameLower);

  const softDelete = async () => {
    const { error } = await supabase
      .from("group_messages")
      .update({ deleted_at: new Date().toISOString(), content: null, attachment_path: null, attachment_name: null, attachment_mime: null })
      .eq("id", m.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Message supprimé");
    qc.invalidateQueries({ queryKey: ["group-messages", m.conversation_id] });
  };

  const saveEdit = async () => {
    const next = draft.trim();
    if (!next || next === m.content) { setEditing(false); return; }
    const { error } = await supabase
      .from("group_messages")
      .update({ content: next, edited_at: new Date().toISOString() })
      .eq("id", m.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Message modifié");
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["group-messages", m.conversation_id] });
  };

  if (isDeleted) {
    return (
      <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
        <div className="max-w-[75%] rounded-2xl px-4 py-2 border border-dashed bg-muted/30 text-muted-foreground italic text-sm">
          Message supprimé le {format(new Date(m.deleted_at), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}
        </div>
      </div>
    );
  }

  return (
    <div className={`group flex ${isMine ? "justify-end" : "justify-start"} items-end gap-2`}>
      <div className={`max-w-[75%] rounded-2xl px-4 py-2 shadow-sm ${isMine ? "bg-primary text-primary-foreground" : "bg-card border"}`}>
        {!isMine && <div className="text-xs font-medium text-muted-foreground mb-1">{senderName}</div>}
        {m.attachment_path && (
          <div className="mb-2 space-y-1">
            {isImg && url ? (
              <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={m.attachment_name} className="rounded-lg max-h-64" /></a>
            ) : isVideo && url ? (
              <video src={url} controls className="rounded-lg max-h-72 w-full" preload="metadata" />
            ) : isAudio && url ? (
              <audio src={url} controls className="w-64 max-w-full" preload="metadata" />
            ) : (
              <a href={url || "#"} target="_blank" rel="noreferrer" className={`flex items-center gap-2 rounded-lg p-2 ${isMine ? "bg-white/10" : "bg-muted"}`}>
                {isPdf ? <FileText className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                <span className="text-xs truncate">{m.attachment_name}</span>
              </a>
            )}
            {!isAudio && !isMine && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await downloadChatFileAttachment(m.attachment_path, m.attachment_name);
                  } catch (error: any) {
                    console.error("Download error", error, "path=", m.attachment_path);
                    toast.error(error?.message || "Fichier introuvable");
                  }
                }}
                className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded ${isMine ? "bg-white/10 hover:bg-white/20" : "bg-muted hover:bg-muted/70"}`}
              >
                <Download className="h-3 w-3" /> Télécharger
              </button>
            )}
          </div>
        )}
        {editing ? (
          <div className="space-y-2">
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="text-sm text-foreground bg-background min-h-[80px]" autoFocus />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setDraft(m.content ?? ""); setEditing(false); }}>
                <X className="h-3.5 w-3.5 mr-1" /> Annuler
              </Button>
              <Button size="sm" onClick={saveEdit}>Enregistrer</Button>
            </div>
          </div>
        ) : (
          m.content && <div className="text-sm whitespace-pre-wrap break-words">{m.content}</div>
        )}
        <div className={`text-[10px] mt-1 ${isMine ? "text-primary-foreground/70 text-right" : "text-muted-foreground"}`}>
          {format(new Date(m.created_at), "HH:mm", { locale: fr })}
          {m.edited_at && <span> · modifié</span>}
        </div>
      </div>
      {canEdit && !editing && (
        <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition" onClick={() => setEditing(true)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {canDelete && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition">
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer ce message ?</AlertDialogTitle>
              <AlertDialogDescription>Cette action est définitive.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={softDelete}>Supprimer</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

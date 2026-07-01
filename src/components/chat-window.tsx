import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Paperclip, Send, Search, Check, CheckCheck, FileText, Image as ImageIcon, Trash2, Pencil, X, Mic, Square } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { fr } from "date-fns/locale";


export function ChatWindow({ clientId, title }: { clientId: string; title?: string }) {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [typing, setTyping] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);


  const { data: messages = [] } = useQuery({
    queryKey: ["messages", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("messages").select("*").eq("client_id", clientId).order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Realtime messages + typing
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`chat-${clientId}`, { config: { broadcast: { self: false } } })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `client_id=eq.${clientId}` },
        () => qc.invalidateQueries({ queryKey: ["messages", clientId] }))
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload.userId !== user.id) {
          setOtherTyping(true);
          setTimeout(() => setOtherTyping(false), 2500);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId, user, qc]);

  // Auto scroll
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, otherTyping]);

  // Mark as read
  useEffect(() => {
    if (!user) return;
    const unread = messages.filter((m) => !m.read_at && m.sender_id !== user.id);
    if (unread.length === 0) return;
    supabase.from("messages").update({ read_at: new Date().toISOString() }).in("id", unread.map((m) => m.id)).then();
  }, [messages, user]);

  const send = useMutation({
    mutationFn: async ({ content, file }: { content: string; file?: File }) => {
      let attachment_path: string | null = null;
      let attachment_name: string | null = null;
      let attachment_mime: string | null = null;
      if (file) {
        const path = `${user!.id}/${crypto.randomUUID()}-${file.name}`;
        const { error } = await supabase.storage.from("chat-files").upload(path, file);
        if (error) throw error;
        attachment_path = path; attachment_name = file.name; attachment_mime = file.type;
      }
      const { error } = await supabase.from("messages").insert({
        client_id: clientId,
        sender_id: user!.id,
        from_agence: isAdmin,
        content: content || null,
        attachment_path, attachment_name, attachment_mime,
      });
      if (error) throw error;
    },
    onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: ["messages", clientId] }); },
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
      } catch {
        // toast déjà émis par onError
        break;
      }
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

  const broadcastTyping = () => {
    supabase.channel(`chat-${clientId}`).send({ type: "broadcast", event: "typing", payload: { userId: user!.id } });
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
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <Card className="flex flex-col flex-1 overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <div className="font-display text-lg">{title || "Discussion avec l'agence"}</div>
            <div className="text-xs text-muted-foreground">
              {otherTyping ? <span className="text-primary animate-pulse">L'agence est en train d'écrire…</span> : "Messagerie sécurisée"}
            </div>
          </div>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input className="pl-8 h-9 w-48" placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/20">
          {filtered.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-12">Aucun message. Envoyez le premier !</div>
          )}
          {filtered.map((m) => (
            <MessageBubble key={m.id} m={m} isMine={m.sender_id === user?.id} isAdmin={isAdmin} />
          ))}

          {otherTyping && (
            <div className="flex gap-1 px-2">
              <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce" />
              <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0.15s]" />
              <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0.3s]" />
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={submit} className="p-3 border-t flex gap-2 items-end bg-background">
          <input ref={fileInput} type="file" hidden onChange={handleFile} />
          <Button type="button" size="icon" variant="ghost" onClick={() => fileInput.current?.click()} disabled={recording}>
            <Paperclip className="h-5 w-5" />
          </Button>
          {recording ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 h-9 rounded-md border bg-red-500/10 text-red-600 text-sm">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                Enregistrement… {String(Math.floor(recordSecs / 60)).padStart(2, "0")}:{String(recordSecs % 60).padStart(2, "0")}
              </div>
              <Button type="button" size="icon" variant="ghost" onClick={() => stopRecording(true)} title="Annuler">
                <X className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon" onClick={() => stopRecording(false)} title="Envoyer le vocal">
                <Send className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Input
                value={text}
                onChange={(e) => { setText(e.target.value); broadcastTyping(); }}
                placeholder="Écrire un message…"
                className="flex-1"
              />
              {text.trim() ? (
                <Button type="submit" size="icon" disabled={send.isPending}><Send className="h-4 w-4" /></Button>
              ) : (
                <Button type="button" size="icon" variant="ghost" onClick={startRecording} title="Message vocal">
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

function MessageBubble({ m, isMine, isAdmin }: { m: any; isMine: boolean; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(m.content ?? "");
  const isDeleted = !!m.deleted_at;
  const canEdit = isAdmin && isMine && !isDeleted && !!m.content;

  useEffect(() => {
    if (!m.attachment_path || isDeleted) return;
    supabase.storage.from("chat-files").createSignedUrl(m.attachment_path, 3600).then(({ data }) => {
      if (data) setUrl(data.signedUrl);
    });
  }, [m.attachment_path, isDeleted]);

  const isImg = m.attachment_mime?.startsWith("image/");
  const isPdf = m.attachment_mime === "application/pdf";
  const isVideo = m.attachment_mime?.startsWith("video/");
  const nameLower = (m.attachment_name ?? "").toLowerCase();
  const isAudio =
    m.attachment_mime?.startsWith("audio/") ||
    nameLower.startsWith("vocal-") ||
    /\.(webm|ogg|oga|mp3|m4a|wav|aac)$/.test(nameLower);

  const softDelete = async () => {
    const { error } = await supabase
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", m.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Message supprimé");
    qc.invalidateQueries({ queryKey: ["messages", m.client_id] });
  };

  const saveEdit = async () => {
    const next = draft.trim();
    if (!next || next === m.content) { setEditing(false); return; }
    const { error } = await supabase
      .from("messages")
      .update({ content: next })
      .eq("id", m.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Message modifié");
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["messages", m.client_id] });
  };

  if (isDeleted) {
    return (
      <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
        <div className="max-w-[75%] rounded-2xl px-4 py-2 border border-dashed bg-muted/30 text-muted-foreground italic text-sm">
          Message supprimé par la direction le {format(new Date(m.deleted_at), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}
        </div>
      </div>
    );
  }

  return (
    <div className={`group flex ${isMine ? "justify-end" : "justify-start"} items-end gap-2`}>
      {isAdmin && !isMine && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition">
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer ce message ?</AlertDialogTitle>
              <AlertDialogDescription>
                Le contenu sera purgé définitivement et remplacé par un marqueur.
                La suppression est journalisée de manière inaltérable (auteur, date, empreinte du contenu).
                Cette action affaiblit la valeur probatoire du chat — à réserver aux cas justifiés.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={softDelete}>Supprimer définitivement</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      <div className={`max-w-[75%] rounded-2xl px-4 py-2 shadow-sm ${isMine ? "bg-primary text-primary-foreground" : "bg-card border"}`}>
        {m.attachment_path && (
          <div className="mb-2">
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
          </div>
        )}
        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="text-sm text-foreground bg-background min-h-[80px]"
              autoFocus
            />
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
        <div className={`text-[10px] mt-1 flex items-center gap-1 ${isMine ? "text-primary-foreground/70 justify-end" : "text-muted-foreground"}`}>
          {format(new Date(m.created_at), "HH:mm", { locale: fr })}
          {m.edited_at && <span title={`Modifié le ${format(new Date(m.edited_at), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}`}>· modifié</span>}
          {isMine && (m.read_at ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />)}
        </div>
      </div>
      {canEdit && !editing && (
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition"
          onClick={() => setEditing(true)}
          title="Modifier"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {isAdmin && isMine && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition">
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer ce message ?</AlertDialogTitle>
              <AlertDialogDescription>
                Suppression définitive. La suppression est journalisée (auteur, date, empreinte SHA-256 du contenu).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={softDelete}>Supprimer définitivement</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createChatFileSignedUrl, downloadChatFileAttachment } from "@/lib/chat-attachments";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Paperclip, Send, Search, FileText, Image as ImageIcon, Trash2, Pencil, X, Mic, Square, Download } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useSwipeReveal } from "@/hooks/use-swipe-reveal";
import { MentionTextarea } from "@/components/mention-textarea";
import { RichMessageContent } from "@/components/rich-message-content";
import { EphemeralSettingsButton, EphemeralBanner } from "@/components/ephemeral-mode";
import { notifyEmail } from "@/lib/email/notify";
import { notifyTeamClientMessage } from "@/lib/email/notify-team";
import { playNotifSound } from "@/lib/notif-sound";


export function ChatWindow({ clientId, title }: { clientId: string; title?: string }) {
  const { user } = useAuth();
  const { isAdmin, isStaff } = useRole();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [typing, setTyping] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [uploading, setUploading] = useState<{ name: string; index: number; total: number; sizeMb: string } | null>(null);
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

  const senderIds = useMemo(() => {
    const s = new Set<string>();
    for (const m of messages) if (m.sender_id) s.add(m.sender_id);
    return Array.from(s).sort();
  }, [messages]);

  const { data: senderMap } = useQuery({
    queryKey: ["chat-senders", senderIds.join(",")],
    enabled: senderIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, prenom, nom, email").in("id", senderIds);
      const map = new Map<string, { name: string; initials: string }>();
      for (const p of data ?? []) {
        const full = `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || "Utilisateur";
        const initials = (((p.prenom?.[0] ?? "") + (p.nom?.[0] ?? "")) || (p.email?.[0] ?? "?")).toUpperCase();
        map.set(p.id, { name: full, initials });
      }
      return map;
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

  // Message pré-rempli (ex : « Je n'ai pas ce document » depuis un dossier)
  useEffect(() => {
    try {
      const p = sessionStorage.getItem("chat-prefill");
      if (p) {
        setText(p);
        sessionStorage.removeItem("chat-prefill");
      }
    } catch {}
  }, []);

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
        const safeName = file.name
          .normalize("NFKD")
          .replace(/[^\w.\-]+/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_|_$/g, "");
        const path = `${user!.id}/dm-${clientId}/${crypto.randomUUID()}-${safeName || "fichier"}`;
        const { error } = await supabase.storage.from("chat-files").upload(path, file);
        if (error) throw error;
        attachment_path = path; attachment_name = file.name; attachment_mime = file.type;
      }
      const { error } = await supabase.from("messages").insert({
        client_id: clientId,
        sender_id: user!.id,
        from_agence: isStaff,
        content: content || null,
        attachment_path, attachment_name, attachment_mime,
      });
      if (error) throw error;
      // Email au client si c'est l'agence qui écrit (fire-and-forget, anti-spam par idempotency 10min)
      if (isStaff) {
        try {
          const { data: prof } = await supabase
            .from("profiles")
            .select("email, prenom")
            .eq("id", clientId)
            .maybeSingle();
          if (prof?.email) {
            const extrait = (content || "").trim().slice(0, 140);
            const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
            notifyEmail({
              templateName: "client-nouveau-message",
              recipientEmail: prof.email,
              idempotencyKey: `client-msg-${clientId}-${bucket}`,
              templateData: { prenom: prof.prenom || "", extrait: extrait || undefined },
            });
          }
        } catch { /* silencieux */ }
      } else {
        // Message envoyé par le client → notifier l'équipe (pôle + admins/direction)
        try {
          const extrait = (content || "").trim().slice(0, 140);
          notifyTeamClientMessage(clientId, extrait || undefined);
        } catch { /* silencieux */ }
      }
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
      const f = files[i];
      setUploading({
        name: f.name,
        index: i + 1,
        total: files.length,
        sizeMb: (f.size / (1024 * 1024)).toFixed(1),
      });
      try {
        await send.mutateAsync({ content: i === 0 ? initialText : "", file: f });
      } catch {
        // toast déjà émis par onError
        break;
      }
    }
    setUploading(null);
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
    <div className="flex flex-col h-[calc(100vh-6rem)] sm:h-[calc(100vh-8rem)]">
      <Card className="flex flex-col flex-1 overflow-hidden rounded-none sm:rounded-xl border-x-0 sm:border-x">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-3 sm:p-4 border-b sm:flex sm:justify-between">
          <div className="min-w-0">
            <div className="font-display text-base sm:text-lg truncate">{title || "Discussion avec l'agence"}</div>
            <div className="text-[11px] sm:text-xs text-muted-foreground truncate">
              {otherTyping ? <span className="text-primary animate-pulse">L'agence est en train d'écrire…</span> : "Messagerie sécurisée"}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isStaff && <EphemeralSettingsButton scope={{ kind: "client", clientId }} />}
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-8 h-9 w-36 sm:w-48"
                placeholder="Rechercher…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
        <EphemeralBanner scope={{ kind: "client", clientId }} />

        <SwipeableList
          filtered={filtered}
          user={user}
          isAdmin={isAdmin}
          otherTyping={otherTyping}
          bottomRef={bottomRef}
          senderMap={senderMap}
        />



        {uploading && (
          <div className="px-3 py-2 border-t bg-primary/5 flex items-center gap-3 text-sm">
            <svg className="h-4 w-4 animate-spin text-primary shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                Envoi en cours… <span className="text-muted-foreground font-normal">{uploading.name}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {uploading.total > 1 ? `Fichier ${uploading.index}/${uploading.total} · ` : ""}{uploading.sizeMb} Mo — merci de patienter
              </div>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="p-2 sm:p-3 border-t flex gap-1.5 sm:gap-2 items-end bg-background sticky bottom-0">
          <input ref={fileInput} type="file" hidden multiple onChange={handleFile} />
          <Button
            type="button"
            variant="ghost"
            onClick={() => fileInput.current?.click()}
            disabled={recording}
            className="h-11 min-w-11 px-2 gap-1 shrink-0"
            aria-label="Joindre un fichier"
            title="Joindre un fichier"
          >
            <Paperclip className="h-5 w-5" />
            <span className="hidden sm:inline text-xs">Fichier</span>
          </Button>
          {recording ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 h-11 rounded-md border bg-red-500/10 text-red-600 text-sm">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                Enregistrement… {String(Math.floor(recordSecs / 60)).padStart(2, "0")}:{String(recordSecs % 60).padStart(2, "0")}
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => stopRecording(true)}
                className="h-11 min-w-11 shrink-0"
                aria-label="Annuler l'enregistrement"
                title="Annuler"
              >
                <X className="h-5 w-5" />
              </Button>
              <Button
                type="button"
                onClick={() => stopRecording(false)}
                className="h-11 min-w-11 gap-1 shrink-0"
                aria-label="Envoyer le vocal"
                title="Envoyer le vocal"
              >
                <Send className="h-5 w-5" />
                <span className="hidden sm:inline">Envoyer</span>
              </Button>
            </>
          ) : (
            <>
              <div className="flex-1" onPaste={handlePaste}>
                <MentionTextarea
                  value={text}
                  onChange={(v) => { setText(v); broadcastTyping(); }}
                  onSubmit={() => { if (text.trim()) send.mutate({ content: text.trim() }); }}
                  enableEntities={isAdmin}
                  enableUsers={false}
                  scopeClientId={clientId}
                  rows={1}
                  placeholder={isAdmin ? "Écrire… # pour lier un dossier / tâche de ce client" : "Écrivez votre message ici, l'agence vous répondra."}
                />
              </div>

              {text.trim() ? (
                <Button
                  type="submit"
                  disabled={send.isPending}
                  className="h-11 min-w-11 gap-1 shrink-0"
                  aria-label="Envoyer le message"
                >
                  <Send className="h-5 w-5" />
                  <span className="hidden sm:inline">Envoyer</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={startRecording}
                  className="h-11 min-w-11 gap-1 shrink-0"
                  aria-label="Message vocal"
                  title="Message vocal"
                >
                  <Mic className="h-5 w-5" />
                  <span className="hidden sm:inline text-xs">Vocal</span>
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
  otherTyping,
  bottomRef,
  senderMap,
}: {
  filtered: any[];
  user: any;
  isAdmin: boolean;
  otherTyping: boolean;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  senderMap?: Map<string, { name: string; initials: string }>;
}) {
  const { dragX, dragging, max, containerProps } = useSwipeReveal(120);
  const shift = { transform: `translateX(-${dragX}px)`, transition: dragging ? "none" : "transform 0.25s ease" };

  return (
    <div
      className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 space-y-2 sm:space-y-3 bg-muted/20"
      {...containerProps}
    >
      {filtered.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-12">Aucun message. Envoyez le premier !</div>
      )}
      {filtered.map((m) => {
        const isMine = m.sender_id === user?.id;
        let info: React.ReactNode;
        if (isMine) {
          info = m.read_at ? (
            <div className="space-y-0.5">
              <div>✓✓ Vu</div>
              <div className="text-[10px] opacity-80">{format(new Date(m.read_at), "dd/MM/yyyy HH:mm", { locale: fr })}</div>
            </div>
          ) : (
            <span>✓ Envoyé</span>
          );
        } else {
          info = <span>Reçu · {format(new Date(m.created_at), "dd/MM HH:mm", { locale: fr })}</span>;
        }
        return (
          <div key={m.id} className="relative">
            <div style={shift}>
              <MessageBubble m={m} isMine={isMine} isAdmin={isAdmin} sender={senderMap?.get(m.sender_id)} />
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
      {otherTyping && (
        <div className="flex gap-1 px-2">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0.15s]" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0.3s]" />
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

function MessageBubble({ m, isMine, isAdmin, sender }: { m: any; isMine: boolean; isAdmin: boolean; sender?: { name: string; initials: string } }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(m.content ?? "");
  const isDeleted = !!m.deleted_at;
  const canEdit = isAdmin && isMine && !isDeleted && !!m.content;

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
      {!isMine && (
        <div
          className="h-7 w-7 shrink-0 rounded-full bg-primary/10 text-primary text-[10px] font-semibold flex items-center justify-center border"
          title={sender?.name || "Agence"}
        >
          {sender?.initials || (m.from_agence ? "AG" : "?")}
        </div>
      )}
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
      <div className={`max-w-[82%] sm:max-w-[75%] rounded-2xl px-3 sm:px-4 py-2 shadow-sm break-words ${isMine ? "bg-primary text-primary-foreground" : "bg-card border"}`}>
        {!isMine && (
          <div className="text-[11px] font-semibold text-primary mb-0.5 truncate">
            {sender?.name || (m.from_agence ? "Agence" : "Utilisateur")}
          </div>
        )}
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
          m.content && <RichMessageContent content={m.content} className="text-sm" inverse={isMine} />
        )}
        <div className={`text-[10px] mt-1 flex items-center gap-1 flex-wrap ${isMine ? "text-primary-foreground/70 justify-end" : "text-muted-foreground"}`}>
          {format(new Date(m.created_at), "HH:mm", { locale: fr })}
          {m.edited_at && <span title={`Modifié le ${format(new Date(m.edited_at), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}`}>· modifié</span>}
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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Paperclip, Send, Search, Trash2, Pencil, X, Mic, ChevronDown, ChevronUp, Loader2, MessagesSquare } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { format, isSameDay } from "date-fns";
import { fr } from "date-fns/locale";
import { useSwipeReveal } from "@/hooks/use-swipe-reveal";
import { MentionTextarea } from "@/components/mention-textarea";
import { RichMessageContent } from "@/components/rich-message-content";
import { EphemeralSettingsButton, EphemeralBanner } from "@/components/ephemeral-mode";
import { ConversationFilesButton } from "@/components/conversation-files-panel";
import { MessageAttachment } from "@/components/message-attachment";

import { notifyEmail } from "@/lib/email/notify";
import { notifyTeamClientMessage } from "@/lib/email/notify-team";
import { playNotifSound } from "@/lib/notif-sound";

/** Nombre de messages chargés au départ, et pas de chaque « page » suivante. */
const PAGE_SIZE = 30;

/**
 * Colonnes réellement affichées. Éviter `select("*")` réduit nettement la taille
 * de la réponse : les colonnes de purge et d'audit ne servent pas à l'affichage.
 */
const MESSAGE_COLS =
  "id, client_id, sender_id, from_agence, content, attachment_path, attachment_name, attachment_mime, created_at, read_at, deleted_at, edited_at, is_system";

type ChatMessage = {
  id: string;
  client_id: string;
  sender_id: string;
  from_agence: boolean;
  content: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  created_at: string;
  read_at: string | null;
  deleted_at: string | null;
  edited_at: string | null;
  is_system: boolean;
};

/** « Aujourd'hui », « Hier », « mardi », puis la date complète au-delà d'une semaine. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diff = Math.round((b - a) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  if (diff > 1 && diff < 7) return format(d, "EEEE", { locale: fr });
  return format(d, "d MMMM yyyy", { locale: fr });
}

/** Un « bloc » regroupe les messages d'un même auteur envoyés à moins de 5 min d'écart. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** PostgREST casse sur les virgules et parenthèses non échappées dans un filtre. */
function sanitizeSearch(term: string): string {
  return term.replace(/[,()"\\%_]/g, " ").replace(/\s+/g, " ").trim();
}

export function ChatWindow({ clientId, title }: { clientId: string; title?: string }) {
  const { user } = useAuth();
  const { isAdmin, isStaff } = useRole();
  const qc = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [otherTyping, setOtherTyping] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [uploading, setUploading] = useState<{ name: string; index: number; total: number; sizeMb: string } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Suivi du défilement : on ne recolle en bas que si l'utilisateur y était déjà.
  const atBottomRef = useRef(true);
  const restoreFromBottomRef = useRef<number | null>(null);
  const markedReadRef = useRef<Set<string>>(new Set());

  // Recherche : on attend 300 ms avant d'interroger le serveur.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Changement de conversation : on repart d'une page propre.
  useEffect(() => {
    setLimit(PAGE_SIZE);
    setSearch("");
    setSearchOpen(false);
    atBottomRef.current = true;
    markedReadRef.current = new Set();
  }, [clientId]);

  const { data: page, isFetching: loadingMessages } = useQuery({
    queryKey: ["messages", clientId, limit],
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: async () => {
      // On prend les N plus RÉCENTS puis on remet dans l'ordre chronologique :
      // la conversation s'ouvre instantanément, même avec des milliers de messages.
      const { data, error, count } = await supabase
        .from("messages")
        .select(MESSAGE_COLS, { count: "exact" })
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return { rows: ((data ?? []) as unknown as ChatMessage[]).slice().reverse(), total: count ?? 0 };
    },
  });

  const messages = useMemo(() => page?.rows ?? [], [page]);
  const total = page?.total ?? 0;
  const olderCount = Math.max(0, total - messages.length);

  const searchTerm = sanitizeSearch(debouncedSearch);
  const isSearching = searchTerm.length >= 2;

  const { data: searchRows, isFetching: searchLoading } = useQuery({
    queryKey: ["messages-search", clientId, searchTerm],
    enabled: isSearching,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      // La recherche porte sur TOUT l'historique, pas seulement sur la page chargée.
      const { data, error } = await supabase
        .from("messages")
        .select(MESSAGE_COLS)
        .eq("client_id", clientId)
        .ilike("content", `%${searchTerm}%`)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return ((data ?? []) as unknown as ChatMessage[]).slice().reverse();
    },
  });

  // Référence stable : sinon l'effet de positionnement se relancerait à chaque rendu.
  const visible = useMemo(
    () => (isSearching ? (searchRows ?? []) : messages),
    [isSearching, searchRows, messages],
  );

  const senderIds = useMemo(() => {
    const s = new Set<string>();
    for (const m of visible) if (m.sender_id) s.add(m.sender_id);
    return Array.from(s).sort();
  }, [visible]);

  const { data: senderMap } = useQuery({
    queryKey: ["chat-senders", senderIds.join(",")],
    enabled: senderIds.length > 0,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
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

  // Realtime messages + indicateur de frappe
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`chat-${clientId}`, { config: { broadcast: { self: false } } })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `client_id=eq.${clientId}` },
        (payload: any) => {
          if (payload.eventType === "INSERT" && payload.new?.sender_id && payload.new.sender_id !== user.id) {
            playNotifSound();
          }
          qc.invalidateQueries({ queryKey: ["messages", clientId] });
        })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload.userId !== user.id) {
          setOtherTyping(true);
          setTimeout(() => setOtherTyping(false), 2500);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId, user, qc]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < 120;
    atBottomRef.current = near;
    setShowJump(!near && el.scrollHeight > el.clientHeight + 200);
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = true;
    setShowJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  /**
   * Positionnement après rendu :
   * - chargement d'anciens messages → on garde sous les yeux le message qu'on lisait ;
   * - sinon on ne recolle en bas que si l'utilisateur y était déjà.
   */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restoreFromBottomRef.current !== null) {
      el.scrollTop = el.scrollHeight - restoreFromBottomRef.current;
      restoreFromBottomRef.current = null;
      handleScroll();
      return;
    }
    if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    else handleScroll();
  }, [visible, otherTyping, isSearching, handleScroll]);

  const loadOlder = (all = false) => {
    const el = scrollRef.current;
    restoreFromBottomRef.current = el ? el.scrollHeight - el.scrollTop : null;
    setLimit((l) => (all ? Math.max(total, l) : l + PAGE_SIZE));
  };

  // Message pré-rempli (ex : « Je n'ai pas ce document » depuis un dossier)
  useEffect(() => {
    try {
      const p = sessionStorage.getItem("chat-prefill");
      if (p) {
        setText(p);
        sessionStorage.removeItem("chat-prefill");
      }
    } catch { /* stockage indisponible */ }
  }, []);

  // Accusés de lecture — une seule fois par message, sans relancer de boucle.
  useEffect(() => {
    if (!user || isSearching) return;
    const unread = messages.filter(
      (m) => !m.read_at && m.sender_id !== user.id && !markedReadRef.current.has(m.id),
    );
    if (unread.length === 0) return;
    for (const m of unread) markedReadRef.current.add(m.id);
    supabase
      .from("messages")
      .update({ read_at: new Date().toISOString(), read_by: user.id } as any)
      .in("id", unread.map((m) => m.id))
      .then();
  }, [messages, user, isSearching]);

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
    onSuccess: () => {
      setText("");
      atBottomRef.current = true;
      qc.invalidateQueries({ queryKey: ["messages", clientId] });
    },
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

  // Un « typing » au plus toutes les 1,5 s : inutile d'inonder le canal à chaque frappe.
  const lastTypingRef = useRef(0);
  const broadcastTyping = () => {
    const now = Date.now();
    if (now - lastTypingRef.current < 1500) return;
    lastTypingRef.current = now;
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
    try { mr.stop(); } catch { /* déjà arrêté */ }
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    setRecording(false);
    setRecordSecs(0);
    mediaRecorderRef.current = null;
  };

  useEffect(() => () => { if (recordTimerRef.current) clearInterval(recordTimerRef.current); }, []);

  const headerInitials =
    (title ?? "").replace(/^Discussion avec\s+/i, "").trim().slice(0, 2).toUpperCase() || "AG";

  return (
    <div className="flex flex-col h-chat min-w-0">
      <Card className="flex flex-col flex-1 overflow-hidden rounded-none sm:rounded-xl border-x-0 sm:border-x">
        {/* ---------- En-tête ---------- */}
        <div className="flex items-center gap-2 px-2.5 py-2 sm:p-4 border-b bg-background">
          <div className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-full border bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
            {headerInitials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-sm sm:text-lg truncate leading-tight">{title || "Discussion avec l'agence"}</div>
            <div className="text-[11px] sm:text-xs text-muted-foreground truncate">
              {otherTyping
                ? <span className="text-primary animate-pulse">en train d'écrire…</span>
                : total > 0
                  ? `${total} message${total > 1 ? "s" : ""} · messagerie sécurisée`
                  : "Messagerie sécurisée"}
            </div>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            {isStaff && <EphemeralSettingsButton scope={{ kind: "client", clientId }} />}
            <ConversationFilesButton scope={{ kind: "client", clientId }} />
            {/* Recherche : icône seule sur mobile, champ visible dès sm */}
            <Button
              type="button"
              variant={searchOpen ? "secondary" : "ghost"}
              size="icon"
              className="h-9 w-9 sm:hidden"
              aria-label="Rechercher dans la discussion"
              onClick={() => setSearchOpen((v) => !v)}
            >
              <Search className="h-4 w-4" />
            </Button>
            <div className="relative hidden sm:block">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-8 pr-8 h-9 w-48"
                placeholder="Rechercher…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted"
                  aria-label="Effacer la recherche"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {searchOpen && (
          <div className="relative p-2 border-b sm:hidden">
            <Search className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              autoFocus
              className="pl-9 pr-9 h-10"
              placeholder="Rechercher dans tout l'historique…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(""); setSearchOpen(false); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted"
                aria-label="Fermer la recherche"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {isSearching && (
          <div className="flex items-center gap-2 border-b bg-primary/5 px-3 py-1.5 text-xs">
            {searchLoading ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" /> Recherche dans l'historique…</>
            ) : (
              <>
                <Search className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="min-w-0 truncate">
                  {(searchRows?.length ?? 0) === 0
                    ? "Aucun message trouvé"
                    : `${searchRows!.length} résultat${searchRows!.length > 1 ? "s" : ""}${searchRows!.length === 50 ? " (50 max)" : ""}`}
                </span>
              </>
            )}
            <button
              type="button"
              onClick={() => { setSearch(""); setSearchOpen(false); }}
              className="ml-auto shrink-0 font-medium text-primary hover:underline"
            >
              Quitter
            </button>
          </div>
        )}

        <EphemeralBanner scope={{ kind: "client", clientId }} />

        {/* ---------- Fil de discussion ---------- */}
        <div className="relative flex-1 min-h-0">
          <MessageList
            messages={visible}
            user={user}
            isAdmin={isAdmin}
            otherTyping={otherTyping && !isSearching}
            senderMap={senderMap}
            scrollRef={scrollRef}
            onScroll={handleScroll}
            isSearching={isSearching}
            olderCount={isSearching ? 0 : olderCount}
            loadingOlder={loadingMessages}
            onLoadOlder={loadOlder}
          />

          {showJump && (
            <button
              type="button"
              onClick={() => scrollToBottom(true)}
              className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur"
              aria-label="Revenir aux derniers messages"
            >
              <ChevronDown className="h-3.5 w-3.5" /> Derniers messages
            </button>
          )}
        </div>

        {uploading && (
          <div className="px-3 py-2 border-t bg-primary/5 flex items-center gap-3 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
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

        {/* ---------- Zone de saisie ---------- */}
        <form onSubmit={submit} className="p-2 sm:p-3 border-t flex gap-1.5 sm:gap-2 items-end bg-background">
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
              <div className="flex-1 min-w-0" onPaste={handlePaste}>
                <MentionTextarea
                  value={text}
                  onChange={(v) => { setText(v); broadcastTyping(); }}
                  onSubmit={() => { if (text.trim()) send.mutate({ content: text.trim() }); }}
                  enableEntities={isAdmin}
                  enableUsers={false}
                  scopeClientId={clientId}
                  rows={1}
                  autoGrow
                  className="min-h-11 max-h-36 resize-none py-2.5 text-base sm:text-sm"
                  placeholder={isAdmin ? "Écrire… # pour lier un dossier / tâche" : "Écrivez votre message…"}
                />
              </div>

              {text.trim() ? (
                <Button
                  type="submit"
                  disabled={send.isPending}
                  className="h-11 min-w-11 gap-1 shrink-0"
                  aria-label="Envoyer le message"
                >
                  {send.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
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

function MessageList({
  messages,
  user,
  isAdmin,
  otherTyping,
  senderMap,
  scrollRef,
  onScroll,
  isSearching,
  olderCount,
  loadingOlder,
  onLoadOlder,
}: {
  messages: ChatMessage[];
  user: any;
  isAdmin: boolean;
  otherTyping: boolean;
  senderMap?: Map<string, { name: string; initials: string }>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  isSearching: boolean;
  olderCount: number;
  loadingOlder: boolean;
  onLoadOlder: (all?: boolean) => void;
}) {
  const { dragX, dragging, max, containerProps } = useSwipeReveal(120);
  const shift = { transform: `translateX(-${dragX}px)`, transition: dragging ? "none" : "transform 0.25s ease" };

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="absolute inset-0 overflow-y-auto overflow-x-hidden bg-muted/20 px-2 py-2 sm:px-4 sm:py-4"
      {...containerProps}
    >
      {/* ---------- Pagination : messages plus anciens ---------- */}
      {!isSearching && olderCount > 0 && (
        <div className="flex flex-col items-center gap-1.5 pb-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingOlder}
            onClick={() => onLoadOlder(false)}
            className="h-8 gap-1.5 rounded-full bg-background text-xs shadow-sm"
          >
            {loadingOlder
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <ChevronUp className="h-3.5 w-3.5" />}
            Messages précédents
            <span className="text-muted-foreground">({olderCount})</span>
          </Button>
          {olderCount > PAGE_SIZE && (
            <button
              type="button"
              disabled={loadingOlder}
              onClick={() => onLoadOlder(true)}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
            >
              Tout afficher ({olderCount} restants)
            </button>
          )}
        </div>
      )}
      {!isSearching && olderCount === 0 && messages.length > PAGE_SIZE && (
        <div className="pb-3 text-center text-[11px] text-muted-foreground">Début de la conversation</div>
      )}

      {messages.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
          <MessagesSquare className="h-8 w-8 opacity-40" />
          {isSearching ? "Aucun message ne correspond." : "Aucun message. Envoyez le premier !"}
        </div>
      )}

      {messages.map((m, i) => {
        const prev = i > 0 ? messages[i - 1] : null;
        const next = i < messages.length - 1 ? messages[i + 1] : null;
        const isMine = m.sender_id === user?.id;

        const newDay = !prev || !isSameDay(new Date(prev.created_at), new Date(m.created_at));
        const startsGroup =
          newDay ||
          !prev ||
          prev.sender_id !== m.sender_id ||
          new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > GROUP_WINDOW_MS;
        const endsGroup =
          !next ||
          next.sender_id !== m.sender_id ||
          !isSameDay(new Date(next.created_at), new Date(m.created_at)) ||
          new Date(next.created_at).getTime() - new Date(m.created_at).getTime() > GROUP_WINDOW_MS;

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
          <div key={m.id}>
            {newDay && (
              <div className="flex justify-center py-2">
                <span className="rounded-full border bg-background/90 px-3 py-1 text-[11px] font-medium capitalize text-muted-foreground shadow-sm">
                  {dayLabel(m.created_at)}
                </span>
              </div>
            )}
            <div className={endsGroup ? "mb-2.5 sm:mb-3" : "mb-0.5"}>
              <div className="relative">
                <div style={shift}>
                  <MessageBubble
                    m={m}
                    isMine={isMine}
                    isAdmin={isAdmin}
                    sender={senderMap?.get(m.sender_id)}
                    startsGroup={startsGroup}
                    endsGroup={endsGroup}
                    showDate={isSearching}
                  />
                </div>
                <div
                  className="absolute top-0 h-full flex items-center text-[11px] text-muted-foreground pl-2 pointer-events-none"
                  style={{ right: `-${max}px`, width: `${max}px`, ...shift, opacity: Math.min(1, dragX / (max * 0.5)) }}
                >
                  {info}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {otherTyping && (
        <div className="flex gap-1 px-2 pb-1">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0.15s]" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0.3s]" />
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  m, isMine, isAdmin, sender, startsGroup, endsGroup, showDate,
}: {
  m: ChatMessage;
  isMine: boolean;
  isAdmin: boolean;
  sender?: { name: string; initials: string };
  startsGroup: boolean;
  endsGroup: boolean;
  showDate?: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(m.content ?? "");
  const isDeleted = !!m.deleted_at;
  const canEdit = isAdmin && isMine && !isDeleted && !!m.content;

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
        <div className="max-w-[80%] rounded-2xl border border-dashed bg-muted/30 px-3 py-1.5 text-xs italic text-muted-foreground">
          Message supprimé le {format(new Date(m.deleted_at!), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}
        </div>
      </div>
    );
  }

  if (m.is_system) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[90%] rounded-full bg-muted px-3 py-1 text-center text-[11px] text-muted-foreground">
          {m.content}
        </div>
      </div>
    );
  }

  // Coins : on n'arrondit que l'extérieur du bloc, façon messagerie mobile.
  const corners = isMine
    ? `rounded-2xl ${startsGroup ? "" : "rounded-tr-md"} ${endsGroup ? "" : "rounded-br-md"}`
    : `rounded-2xl ${startsGroup ? "" : "rounded-tl-md"} ${endsGroup ? "" : "rounded-bl-md"}`;

  return (
    <div data-message-id={m.id} className={`group flex ${isMine ? "justify-end" : "justify-start"} items-end gap-1.5 sm:gap-2`}>
      {!isMine && (
        // Avatar seulement en bas du bloc ; la case vide garde l'alignement.
        <div className="h-7 w-7 shrink-0">
          {endsGroup && (
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full border bg-primary/10 text-[10px] font-semibold text-primary"
              title={sender?.name || "Agence"}
            >
              {sender?.initials || (m.from_agence ? "AG" : "?")}
            </div>
          )}
        </div>
      )}

      {isAdmin && !isMine && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon" variant="ghost" className="hidden h-6 w-6 opacity-0 transition group-hover:opacity-100 sm:inline-flex">
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

      <div
        className={`max-w-[82%] min-w-0 overflow-hidden break-words px-3 py-1.5 shadow-sm sm:max-w-[72%] sm:px-3.5 sm:py-2 ${corners} ${
          isMine ? "bg-primary text-primary-foreground" : "border bg-card"
        }`}
      >
        {!isMine && startsGroup && (
          <div className="mb-0.5 truncate text-[11px] font-semibold text-primary">
            {sender?.name || (m.from_agence ? "Agence" : "Utilisateur")}
          </div>
        )}
        {m.attachment_path && (
          <MessageAttachment
            bucket="chat-files"
            path={m.attachment_path}
            name={m.attachment_name}
            mime={m.attachment_mime}
            inverse={isMine}
            showDownload={!isMine}
          />
        )}

        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[80px] bg-background text-sm text-foreground"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setDraft(m.content ?? ""); setEditing(false); }}>
                <X className="mr-1 h-3.5 w-3.5" /> Annuler
              </Button>
              <Button size="sm" onClick={saveEdit}>Enregistrer</Button>
            </div>
          </div>
        ) : (
          m.content && <RichMessageContent content={m.content} className="text-[15px] leading-snug sm:text-sm" inverse={isMine} />
        )}

        <div
          className={`mt-0.5 flex items-center gap-1 text-[10px] ${
            isMine ? "justify-end text-primary-foreground/70" : "text-muted-foreground"
          }`}
        >
          {showDate && <span>{format(new Date(m.created_at), "dd/MM", { locale: fr })}</span>}
          <span>{format(new Date(m.created_at), "HH:mm", { locale: fr })}</span>
          {m.edited_at && (
            <span title={`Modifié le ${format(new Date(m.edited_at), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}`}>· modifié</span>
          )}
          {isMine && <span aria-label={m.read_at ? "Vu" : "Envoyé"}>{m.read_at ? "✓✓" : "✓"}</span>}
        </div>
      </div>

      {canEdit && !editing && (
        <Button
          size="icon"
          variant="ghost"
          className="hidden h-6 w-6 opacity-0 transition group-hover:opacity-100 sm:inline-flex"
          onClick={() => setEditing(true)}
          title="Modifier"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {isAdmin && isMine && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon" variant="ghost" className="hidden h-6 w-6 opacity-0 transition group-hover:opacity-100 sm:inline-flex">
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

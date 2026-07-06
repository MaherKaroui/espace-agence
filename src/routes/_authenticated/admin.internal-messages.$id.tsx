import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Send, Paperclip, Loader2, Download, Star, Bell, BellOff, Archive, ArchiveRestore,
  Building2, FolderOpen, ClipboardCheck, Users, Users2, MessageSquare, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import {
  markInternalConversationRead,
  setInternalConversationFlag,
  setInternalConversationArchived,
} from "@/lib/internal-messages.functions";
import { InternalConversationsSidebar, conversationDisplayTitle } from "./admin.internal-messages.index";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { categorieLabel } from "@/lib/labels";
import { MentionTextarea } from "@/components/mention-textarea";
import { RichMessageContent } from "@/components/rich-message-content";
import { extractMentions } from "@/lib/mentions";
import { ConversationSummaryButton } from "@/components/conversation-summary-button";
import { CreateTaskFromMessageDialog } from "@/components/create-task-from-message-dialog";
import { MessageReactions } from "@/components/message-reactions";
import { ThreadPane } from "@/components/thread-pane";
import { MessageSquareReply, Sparkles as SparklesIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/internal-messages/$id")({
  head: () => ({ meta: [{ title: "Conversation interne" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
  },
  component: InternalConversation,
});

function InternalConversation() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const nav = useNavigate();

  return (
    <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] lg:grid-cols-[300px_1fr_320px] gap-4 min-h-[calc(100vh-8rem)]">
      <div className="hidden md:block">
        <InternalConversationsSidebar activeId={id} />
      </div>

      <div className="min-w-0">
        <button
          onClick={() => nav({ to: "/admin/internal-messages" })}
          className="md:hidden text-sm text-muted-foreground flex items-center gap-1 hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-4 w-4" /> Retour
        </button>
        <ConversationPane id={id} userId={user?.id ?? null} />
      </div>

      <div className="hidden lg:block">
        <ContextPanel conversationId={id} />
      </div>
    </div>
  );
}

// -------- Panneau central --------

function ConversationPane({ id, userId }: { id: string; userId: string | null }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState("");
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const [taskFromMessageId, setTaskFromMessageId] = useState<string | null>(null);
  const markRead = useServerFn(markInternalConversationRead);
  const setFlagFn = useServerFn(setInternalConversationFlag);
  const setArchivedFn = useServerFn(setInternalConversationArchived);

  const { data: conv } = useQuery({
    queryKey: ["internal-conv", id],
    queryFn: async () =>
      (await supabase.from("internal_conversations").select("*").eq("id", id).maybeSingle()).data,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["internal-conv-members", id],
    queryFn: async () => {
      const { data: mems } = await supabase
        .from("internal_conversation_members")
        .select("user_id, role, favorite, muted, last_read_at")
        .eq("conversation_id", id);
      const ids = ((mems ?? []) as any[]).map((m) => m.user_id);
      if (ids.length === 0) return [];
      const { data: profs } = await supabase.from("profiles").select("id, prenom, nom, email").in("id", ids);
      const profById = new Map(((profs ?? []) as any[]).map((p) => [p.id, p]));
      return ((mems ?? []) as any[]).map((m) => ({ ...m, profile: profById.get(m.user_id) }));
    },
  });

  const myMembership = members.find((m: any) => m.user_id === userId);

  const { data: messages = [] } = useQuery({
    queryKey: ["internal-messages", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("internal_messages")
        .select("*")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true });
      return data ?? [];
    },
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!userId) return;
    markRead({ data: { conversationId: id } })
      .then(() => qc.invalidateQueries({ queryKey: ["internal-conversations-full"] }))
      .catch(() => {});
  }, [id, userId, messages.length]);

  useEffect(() => {
    const ch = supabase
      .channel(`internal-msgs-${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "internal_messages", filter: `conversation_id=eq.${id}` },
        () => {
          qc.invalidateQueries({ queryKey: ["internal-messages", id] });
          qc.invalidateQueries({ queryKey: ["internal-conversations-full"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id, qc]);

  const send = useMutation({
    mutationFn: async (payload: { content?: string; file?: File | null }) => {
      let attachment_path: string | null = null;
      let attachment_name: string | null = null;
      let attachment_mime: string | null = null;
      if (payload.file) {
        const ext = payload.file.name.split(".").pop() ?? "bin";
        const path = `${id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("internal-chat-files")
          .upload(path, payload.file, { cacheControl: "3600" });
        if (upErr) throw upErr;
        attachment_path = path;
        attachment_name = payload.file.name;
        attachment_mime = payload.file.type;
      }
      const text = payload.content?.trim() || null;
      const { users, entities } = text
        ? extractMentions(text)
        : { users: [], entities: [] };
      const { error } = await supabase.from("internal_messages").insert({
        conversation_id: id,
        sender_id: userId!,
        content: text,
        attachment_path,
        attachment_name,
        attachment_mime,
        mentions_users: users.map((u) => u.id),
        mentions_entities: entities as any,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setContent("");
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["internal-messages", id] });
      qc.invalidateQueries({ queryKey: ["internal-conversations-full"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Envoi impossible"),
  });

  const toggleFav = useMutation({
    mutationFn: () => setFlagFn({ data: { conversationId: id, favorite: !myMembership?.favorite } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["internal-conv-members", id] });
      qc.invalidateQueries({ queryKey: ["internal-conversations-full"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const toggleMute = useMutation({
    mutationFn: () => setFlagFn({ data: { conversationId: id, muted: !myMembership?.muted } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["internal-conv-members", id] }),
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const toggleArchive = useMutation({
    mutationFn: () => setArchivedFn({ data: { conversationId: id, archived: !conv?.archived_at } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["internal-conv", id] });
      qc.invalidateQueries({ queryKey: ["internal-conversations-full"] });
      toast.success(conv?.archived_at ? "Conversation réactivée" : "Conversation archivée");
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const openAttachment = async (path: string) => {
    const { data, error } = await supabase.storage.from("internal-chat-files").createSignedUrl(path, 300);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  const profileFor = (uid: string) => members.find((m: any) => m.user_id === uid)?.profile;
  const title = conv?.titre || conversationDisplayTitle({ others: members.filter((m: any) => m.user_id !== userId) } as any, userId);

  const typeIcon: Record<string, any> = {
    pole: Users,
    client: Building2,
    dossier: FolderOpen,
    task: ClipboardCheck,
    direct: Users2,
    custom: MessageSquare,
  };
  const TypeIcon = typeIcon[conv?.type ?? "direct"] ?? MessageSquare;

  return (
    <Card className="flex flex-col h-[calc(100vh-8rem)] overflow-hidden">
      <div className="border-b px-4 py-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <TypeIcon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="font-display text-lg truncate">{title}</div>
            <div className="text-xs text-muted-foreground truncate">
              {members.length} membre{members.length > 1 ? "s" : ""}
              {conv?.type && conv.type !== "direct" && (
                <> · <span className="capitalize">{conv.type}</span></>
              )}
              {conv?.archived_at && <> · <span className="text-warning-foreground">Archivée</span></>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <ConversationSummaryButton conversationId={id} />
          <Button
            variant="ghost"
            size="icon"
            title={myMembership?.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
            onClick={() => toggleFav.mutate()}
            disabled={toggleFav.isPending}
          >
            <Star className={cn("h-4 w-4", myMembership?.favorite && "fill-warning text-warning")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={myMembership?.muted ? "Réactiver les notifications" : "Couper les notifications"}
            onClick={() => toggleMute.mutate()}
            disabled={toggleMute.isPending}
          >
            {myMembership?.muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={conv?.archived_at ? "Réactiver" : "Archiver"}
            onClick={() => toggleArchive.mutate()}
            disabled={toggleArchive.isPending}
          >
            {conv?.archived_at ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Aucun message pour l'instant — soyez la première à écrire.
          </p>
        )}
        {(() => {
          const replyCounts = new Map<string, number>();
          for (const x of messages as any[]) {
            if (x.parent_message_id) {
              replyCounts.set(x.parent_message_id, (replyCounts.get(x.parent_message_id) ?? 0) + 1);
            }
          }
          const roots = (messages as any[]).filter((m) => !m.parent_message_id);
          return roots.map((m: any) => {
            const mine = m.sender_id === userId;
            const author = profileFor(m.sender_id);
            const authorLabel = `${author?.prenom ?? ""} ${author?.nom ?? ""}`.trim() || author?.email || "Membre";
            const replyCount = replyCounts.get(m.id) ?? 0;
            return (
              <div key={m.id} className={cn("group flex", mine ? "justify-end" : "justify-start")}>
                <div className={cn("flex flex-col gap-1 max-w-[80%]", mine ? "items-end" : "items-start")}>
                  <div className="relative">
                    <div
                      className={cn(
                        "rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                        mine ? "bg-primary text-primary-foreground" : "bg-muted",
                      )}
                    >
                      {!mine && <div className="text-[10px] font-medium opacity-80 mb-0.5">{authorLabel}</div>}
                      {m.content && <RichMessageContent content={m.content} currentUserId={userId} />}
                      {m.attachment_path && (
                        <button
                          onClick={() => openAttachment(m.attachment_path)}
                          className="mt-1 flex items-center gap-1 text-xs underline underline-offset-2"
                        >
                          <Download className="h-3 w-3" /> {m.attachment_name || "Pièce jointe"}
                        </button>
                      )}
                      <div className={cn("text-[10px] mt-1", mine ? "opacity-80" : "text-muted-foreground")}>
                        {formatDistanceToNow(new Date(m.created_at), { addSuffix: true, locale: fr })}
                      </div>
                    </div>
                    {/* Actions hover */}
                    <div
                      className={cn(
                        "absolute -top-3 flex items-center gap-0.5 rounded-full border bg-background shadow-sm px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity",
                        mine ? "right-2" : "left-2",
                      )}
                    >
                      <button
                        onClick={() => setThreadParentId(m.id)}
                        className="h-6 w-6 rounded-full hover:bg-muted flex items-center justify-center"
                        title="Répondre dans un fil"
                      >
                        <MessageSquareReply className="h-3.5 w-3.5" />
                      </button>
                      {m.content && (
                        <button
                          onClick={() => setTaskFromMessageId(m.id)}
                          className="h-6 w-6 rounded-full hover:bg-muted flex items-center justify-center"
                          title="Créer une tâche depuis ce message (IA)"
                        >
                          <SparklesIcon className="h-3.5 w-3.5 text-primary" />
                        </button>
                      )}
                    </div>
                  </div>
                  <MessageReactions messageId={m.id} currentUserId={userId} />
                  {replyCount > 0 && (
                    <button
                      onClick={() => setThreadParentId(m.id)}
                      className="text-[11px] text-primary hover:underline flex items-center gap-1"
                    >
                      <MessageSquareReply className="h-3 w-3" />
                      {replyCount} réponse{replyCount > 1 ? "s" : ""}
                    </button>
                  )}
                </div>
              </div>
            );
          });
        })()}
      </div>

      {taskFromMessageId && (
        <CreateTaskFromMessageDialog
          open={!!taskFromMessageId}
          onOpenChange={(v) => !v && setTaskFromMessageId(null)}
          messageId={taskFromMessageId}
        />
      )}
      <ThreadPane
        parentId={threadParentId}
        conversationId={id}
        userId={userId}
        onClose={() => setThreadParentId(null)}
      />


      <div className="border-t p-3 space-y-2">
        <MentionTextarea
          value={content}
          onChange={setContent}
          onSubmit={() => send.mutate({ content })}
          conversationId={id}
          placeholder="Écrire un message…  @ pour mentionner  ·  # pour lier un client / dossier / tâche"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) send.mutate({ file: f });
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={send.isPending}
            >
              <Paperclip className="h-4 w-4 mr-2" /> Pièce jointe
            </Button>
          </div>
          <Button onClick={() => send.mutate({ content })} disabled={send.isPending || !content.trim()}>
            {send.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Envoyer
          </Button>
        </div>
      </div>
    </Card>
  );
}

// -------- Panneau contexte intelligent (droite) --------

function ContextPanel({ conversationId }: { conversationId: string }) {
  const { data: conv } = useQuery({
    queryKey: ["internal-conv-ctx", conversationId],
    queryFn: async () =>
      (await supabase.from("internal_conversations").select("*").eq("id", conversationId).maybeSingle()).data,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["internal-conv-members-panel", conversationId],
    queryFn: async () => {
      const { data: mems } = await supabase
        .from("internal_conversation_members")
        .select("user_id, role")
        .eq("conversation_id", conversationId);
      const ids = ((mems ?? []) as any[]).map((r) => r.user_id);
      if (ids.length === 0) return [];
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, prenom, nom, email")
        .in("id", ids);
      const profById = new Map(((profs ?? []) as any[]).map((p) => [p.id, p]));
      return ((mems ?? []) as any[]).map((m) => ({ ...m, profile: profById.get(m.user_id) }));
    },
  });

  if (!conv) {
    return <Card className="p-4 text-xs text-muted-foreground">Chargement…</Card>;
  }

  return (
    <Card className="flex flex-col overflow-hidden max-h-[calc(100vh-8rem)]">
      <div className="p-3 border-b">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          Contexte
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Info générale */}
        <div>
          <div className="text-sm font-medium">{conv.titre ?? "Conversation"}</div>
          {conv.description && (
            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{conv.description}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
            {conv.type && (
              <Badge variant="outline" className="capitalize">
                {conv.type === "channel" ? "Canal" :
                 conv.type === "group" ? "Groupe" :
                 conv.type === "announcement" ? "Annonces" :
                 conv.type === "pole" ? "Pôle" :
                 conv.type === "direct" ? "Direct" : conv.type}
              </Badge>
            )}
            {conv.is_private && <Badge variant="outline">Privé</Badge>}
            {conv.admin_only_posting && <Badge variant="outline">Admin uniquement</Badge>}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Créée le {new Date(conv.created_at).toLocaleDateString("fr-FR")}
          </div>
        </div>

        {conv.type === "pole" && conv.pole_id && <PoleContext poleId={conv.pole_id} />}

        {/* Membres — toujours affichés */}
        <div>
          <SectionTitle icon={Users2} label={`Membres (${members.length})`} />
          <div className="mt-1 space-y-0.5">
            {(members as any[]).map((m: any) => {
              const name =
                `${m.profile?.prenom ?? ""} ${m.profile?.nom ?? ""}`.trim() ||
                m.profile?.email ||
                "Membre";
              return (
                <div key={m.user_id} className="text-sm flex items-center justify-between gap-2">
                  <span className="truncate">{name}</span>
                  {m.role === "owner" && <Badge variant="outline" className="text-[10px]">owner</Badge>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

function PoleContext({ poleId }: { poleId: string }) {
  const { data: pole } = useQuery({
    queryKey: ["ctx-pole", poleId],
    queryFn: async () => (await supabase.from("poles").select("*").eq("id", poleId).maybeSingle()).data,
  });
  if (!pole) return null;
  return (
    <div>
      <SectionTitle icon={Users} label="Pôle" />
      <div className="mt-1 text-sm font-medium flex items-center gap-2">
        {pole.couleur && (
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: pole.couleur }} />
        )}
        {pole.nom}
      </div>
      {pole.description && (
        <p className="text-xs text-muted-foreground mt-1">{pole.description}</p>
      )}
    </div>
  );
}

function SectionTitle({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
      <Icon className="h-3 w-3" /> {label}
    </div>
  );
}


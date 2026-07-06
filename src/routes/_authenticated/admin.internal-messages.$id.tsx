import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Send, Paperclip, Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { markInternalConversationRead } from "@/lib/internal-messages.functions";

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
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState("");
  const markRead = useServerFn(markInternalConversationRead);

  const { data: conv } = useQuery({
    queryKey: ["internal-conv", id],
    queryFn: async () => (await supabase.from("internal_conversations").select("*").eq("id", id).maybeSingle()).data,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["internal-conv-members", id],
    queryFn: async () => {
      const { data: mems } = await supabase
        .from("internal_conversation_members")
        .select("user_id, role")
        .eq("conversation_id", id);
      const ids = (mems ?? []).map((m: any) => m.user_id);
      if (ids.length === 0) return [];
      const { data: profs } = await supabase.from("profiles").select("id, prenom, nom, email").in("id", ids);
      const profById = new Map((profs ?? []).map((p: any) => [p.id, p]));
      return (mems ?? []).map((m: any) => ({ ...m, profile: profById.get(m.user_id) }));
    },
  });

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
    if (!user) return;
    markRead({ data: { conversationId: id } }).catch(() => {});
  }, [id, user, messages.length]);

  useEffect(() => {
    const ch = supabase
      .channel(`internal-msgs-${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "internal_messages", filter: `conversation_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["internal-messages", id] }),
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
      const { error } = await supabase.from("internal_messages").insert({
        conversation_id: id,
        sender_id: user!.id,
        content: payload.content?.trim() || null,
        attachment_path,
        attachment_name,
        attachment_mime,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setContent("");
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["internal-messages", id] });
      qc.invalidateQueries({ queryKey: ["internal-conversations"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Envoi impossible"),
  });

  const openAttachment = async (path: string) => {
    const { data, error } = await supabase.storage.from("internal-chat-files").createSignedUrl(path, 300);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  const profileFor = (uid: string) => members.find((m: any) => m.user_id === uid)?.profile;
  const title =
    conv?.titre ||
    members
      .filter((m: any) => m.user_id !== user?.id)
      .map((m: any) => `${m.profile?.prenom ?? ""} ${m.profile?.nom ?? ""}`.trim() || m.profile?.email)
      .join(", ") ||
    "Conversation";

  return (
    <div className="space-y-4">
      <button
        onClick={() => nav({ to: "/admin/internal-messages" })}
        className="text-sm text-muted-foreground flex items-center gap-1 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Retour
      </button>

      <Card className="flex flex-col h-[70vh]">
        <div className="border-b px-4 py-3">
          <div className="font-display text-lg truncate">{title}</div>
          <div className="text-xs text-muted-foreground">
            {members.length} membre{members.length > 1 ? "s" : ""}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center">Aucun message pour l'instant.</p>
          )}
          {messages.map((m: any) => {
            const mine = m.sender_id === user?.id;
            const author = profileFor(m.sender_id);
            const authorLabel = `${author?.prenom ?? ""} ${author?.nom ?? ""}`.trim() || author?.email || "Membre";
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                >
                  {!mine && <div className="text-[10px] font-medium opacity-70 mb-0.5">{authorLabel}</div>}
                  {m.content && <div className="whitespace-pre-wrap break-words">{m.content}</div>}
                  {m.attachment_path && (
                    <button
                      onClick={() => openAttachment(m.attachment_path)}
                      className="mt-1 flex items-center gap-1 text-xs underline underline-offset-2"
                    >
                      <Download className="h-3 w-3" /> {m.attachment_name || "Pièce jointe"}
                    </button>
                  )}
                  <div className={`text-[10px] mt-1 ${mine ? "opacity-80" : "text-muted-foreground"}`}>
                    {formatDistanceToNow(new Date(m.created_at), { addSuffix: true, locale: fr })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t p-3 space-y-2">
          <Textarea
            rows={2}
            placeholder="Écrire un message…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && content.trim()) {
                e.preventDefault();
                send.mutate({ content });
              }
            }}
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
            <Button
              onClick={() => send.mutate({ content })}
              disabled={send.isPending || !content.trim()}
            >
              {send.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Envoyer
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

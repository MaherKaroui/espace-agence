import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { MentionTextarea } from "@/components/mention-textarea";
import { RichMessageContent } from "@/components/rich-message-content";
import { MessageReactions } from "@/components/message-reactions";
import { extractMentions } from "@/lib/mentions";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

export function ThreadPane({
  parentId,
  conversationId,
  userId,
  onClose,
}: {
  parentId: string | null;
  conversationId: string;
  userId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState("");

  const { data: parent } = useQuery({
    queryKey: ["internal-msg", parentId],
    enabled: !!parentId,
    queryFn: async () => {
      const { data } = await supabase.from("internal_messages").select("*").eq("id", parentId!).maybeSingle();
      return data;
    },
  });

  const { data: replies = [] } = useQuery({
    queryKey: ["internal-thread", parentId],
    enabled: !!parentId,
    queryFn: async () => {
      const { data } = await supabase
        .from("internal_messages")
        .select("*")
        .eq("parent_message_id", parentId!)
        .order("created_at", { ascending: true });
      return data ?? [];
    },
  });

  const { data: profs = new Map<string, any>() } = useQuery({
    queryKey: ["internal-thread-profiles", parentId, replies.length, parent?.sender_id],
    enabled: !!parent,
    queryFn: async () => {
      const ids = Array.from(
        new Set([parent?.sender_id, ...replies.map((m: any) => m.sender_id)].filter(Boolean)),
      ) as string[];
      if (ids.length === 0) return new Map();
      const { data } = await supabase.from("profiles").select("id, prenom, nom, email").in("id", ids);
      return new Map(((data ?? []) as any[]).map((p) => [p.id, p]));
    },
  });

  useEffect(() => {
    if (!parentId) return;
    const ch = supabase
      .channel(`internal-thread-${parentId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "internal_messages",
          filter: `parent_message_id=eq.${parentId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["internal-thread", parentId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [parentId, qc]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [replies.length]);

  const send = useMutation({
    mutationFn: async () => {
      if (!content.trim() || !userId || !parentId) return;
      const { users, entities } = extractMentions(content);
      const { error } = await supabase.from("internal_messages").insert({
        conversation_id: conversationId,
        sender_id: userId,
        content: content.trim(),
        parent_message_id: parentId,
        mentions_users: users.map((u) => u.id),
        mentions_entities: entities as any,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setContent("");
      qc.invalidateQueries({ queryKey: ["internal-thread", parentId] });
      qc.invalidateQueries({ queryKey: ["internal-messages", conversationId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Envoi impossible"),
  });

  const nameFor = (uid: string) => {
    const p = (profs as any as Map<string, any>).get?.(uid);
    return `${p?.prenom ?? ""} ${p?.nom ?? ""}`.trim() || p?.email || "Membre";
  };

  return (
    <Sheet open={!!parentId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0 gap-0">
        <SheetHeader className="p-4 border-b">
          <SheetTitle className="text-base">Fil de discussion</SheetTitle>
        </SheetHeader>

        {parent && (
          <div className="p-4 border-b bg-muted/30">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">
              {nameFor(parent.sender_id)} · {formatDistanceToNow(new Date(parent.created_at), { addSuffix: true, locale: fr })}
            </div>
            {parent.content && <RichMessageContent content={parent.content} currentUserId={userId} className="text-sm" inverse={parent.sender_id === userId} />}
            <div className="mt-2">
              <MessageReactions messageId={parent.id} currentUserId={userId} />
            </div>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {replies.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">Pas encore de réponse dans ce fil.</p>
          )}
          {replies.map((m: any) => {
            const mine = m.sender_id === userId;
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3 py-1.5 text-sm shadow-sm",
                    mine ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  {!mine && <div className="text-[10px] font-medium opacity-80 mb-0.5">{nameFor(m.sender_id)}</div>}
                  {m.content && <RichMessageContent content={m.content} currentUserId={userId} inverse={mine} />}
                  <div className={cn("text-[10px] mt-0.5", mine ? "opacity-80" : "text-muted-foreground")}>
                    {formatDistanceToNow(new Date(m.created_at), { addSuffix: true, locale: fr })}
                  </div>
                  <div className="mt-1">
                    <MessageReactions messageId={m.id} currentUserId={userId} compact />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t p-3 space-y-2">
          <MentionTextarea
            value={content}
            onChange={setContent}
            onSubmit={() => send.mutate()}
            conversationId={conversationId}
            placeholder="Répondre dans le fil…"
            rows={2}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={() => send.mutate()} disabled={send.isPending || !content.trim()}>
              {send.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Répondre
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

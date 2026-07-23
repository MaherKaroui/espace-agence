import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Send, Paperclip, Download, Loader2, MessageSquare, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { openDossierExternalConversation } from "@/lib/dossier-external-chat.functions";
import { markExternalConversationRead } from "@/lib/qualiopi-notifications.functions";
import { roleLabelFr } from "@/lib/role-labels";


/**
 * Chat cloisonné d'un dossier avec les intervenants externes (auditeur / certificateur)
 * + agence (admin/direction/pôle du dossier).
 * Auto-ouvre / crée la conversation "external" liée au dossier.
 */
export function DossierExternalChat({ dossierId }: { dossierId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const openFn = useServerFn(openDossierExternalConversation);
  const markReadFn = useServerFn(markExternalConversationRead);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [content, setContent] = useState("");

  const { data: conv, isLoading, error } = useQuery({
    queryKey: ["ext-conv", dossierId],
    queryFn: () => openFn({ data: { dossierId } }),
    retry: false,
  });
  const conversationId = conv?.id ?? null;

  const { data: members = [] } = useQuery({
    queryKey: ["ext-conv-members", conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const { data: mems } = await supabase
        .from("internal_conversation_members")
        .select("user_id, role")
        .eq("conversation_id", conversationId!);
      const ids = ((mems ?? []) as any[]).map((m) => m.user_id);
      if (ids.length === 0) return [];
      const [{ data: profs }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id, prenom, nom, email").in("id", ids),
        supabase.from("user_roles").select("user_id, role").in("user_id", ids),
      ]);
      const profById = new Map(((profs ?? []) as any[]).map((p) => [p.id, p]));
      const rolesById = new Map<string, string[]>();
      ((roles ?? []) as any[]).forEach((r) => {
        const arr = rolesById.get(r.user_id) ?? [];
        arr.push(r.role);
        rolesById.set(r.user_id, arr);
      });
      return ((mems ?? []) as any[]).map((m) => ({
        ...m,
        profile: profById.get(m.user_id),
        roles: rolesById.get(m.user_id) ?? [],
      }));
    },
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["ext-messages", conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const { data } = await supabase
        .from("internal_messages")
        .select("*")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: true });
      return (data ?? []) as any[];
    },
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Marquer comme lu au montage et à chaque nouveau message
  useEffect(() => {
    if (!conversationId) return;
    markReadFn({ data: { dossierId } })
      .then(() => qc.invalidateQueries({ queryKey: ["ext-unread-counts"] }))
      .catch(() => {});
  }, [conversationId, messages, markReadFn, dossierId, qc]);


  useEffect(() => {
    if (!conversationId) return;
    const ch = supabase
      .channel(`ext-conv-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "internal_messages", filter: `conversation_id=eq.${conversationId}` },
        () => qc.invalidateQueries({ queryKey: ["ext-messages", conversationId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId, qc]);

  const send = useMutation({
    mutationFn: async (payload: { content?: string; file?: File | null }) => {
      if (!conversationId || !user) return;
      let attachment_path: string | null = null;
      let attachment_name: string | null = null;
      let attachment_mime: string | null = null;
      if (payload.file) {
        const ext = payload.file.name.split(".").pop() ?? "bin";
        const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("internal-chat-files")
          .upload(path, payload.file, { cacheControl: "3600" });
        if (upErr) throw upErr;
        attachment_path = path;
        attachment_name = payload.file.name;
        attachment_mime = payload.file.type;
      }
      const text = payload.content?.trim() || null;
      if (!text && !attachment_path) return;
      const { error } = await supabase.from("internal_messages").insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content: text,
        attachment_path,
        attachment_name,
        attachment_mime,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setContent("");
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["ext-messages", conversationId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Envoi impossible"),
  });

  const openAttachment = async (path: string) => {
    const { data, error } = await supabase.storage.from("internal-chat-files").createSignedUrl(path, 300);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  const profileFor = (uid: string) => (members as any[]).find((m) => m.user_id === uid);
  const externalCount = (members as any[]).filter((m) =>
    (m.roles ?? []).some((r: string) => r === "auditeur" || r === "certificateur"),
  ).length;

  if (isLoading) {
    return (
      <Card className="p-6 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Ouverture du canal d'audit…
      </Card>
    );
  }
  if (error) {
    return (
      <Card className="p-6 text-sm text-destructive">
        {(error as any)?.message ?? "Impossible d'ouvrir le canal d'audit."}
      </Card>
    );
  }

  return (
    <Card className="flex flex-col h-[calc(100vh-16rem)] min-h-[420px] overflow-hidden">
      <div className="border-b px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="font-display text-base truncate">Canal d'audit du dossier</div>
            <div className="text-xs text-muted-foreground truncate">
              {(members as any[]).length} membre{(members as any[]).length > 1 ? "s" : ""}
              {externalCount > 0 && <> · {externalCount} intervenant{externalCount > 1 ? "s" : ""} externe{externalCount > 1 ? "s" : ""}</>}
            </div>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {(messages as any[]).length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-8">
            <MessageSquare className="h-6 w-6 mx-auto mb-2 opacity-60" />
            Aucun message. Démarrez la discussion avec l'auditeur / certificateur.
          </div>
        )}
        {(messages as any[]).map((m) => {
          const mine = m.sender_id === user?.id;
          const author = profileFor(m.sender_id);
          const authorName =
            `${author?.profile?.prenom ?? ""} ${author?.profile?.nom ?? ""}`.trim() ||
            author?.profile?.email ||
            "Membre";
          const authorRole = author?.roles?.[0] ? roleLabelFr(author.roles[0]) : null;
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[80%] flex flex-col gap-1", mine ? "items-end" : "items-start")}>
                <div
                  className={cn(
                    "rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                    mine ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  {!mine && (
                    <div className="text-[10px] font-medium opacity-80 mb-0.5 flex items-center gap-1.5">
                      <span>{authorName}</span>
                      {authorRole && <Badge variant="outline" className="text-[9px] py-0 px-1">{authorRole}</Badge>}
                    </div>
                  )}
                  {m.content && <div className="whitespace-pre-wrap break-words">{m.content}</div>}
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
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t p-3 space-y-2">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (content.trim()) send.mutate({ content });
            }
          }}
          placeholder="Écrire un message à l'auditeur / certificateur…"
          rows={2}
          className="resize-none"
        />
        <div className="flex items-center justify-between gap-2">
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
          <Button onClick={() => send.mutate({ content })} disabled={send.isPending || !content.trim()}>
            {send.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Envoyer
          </Button>
        </div>
      </div>
    </Card>
  );
}

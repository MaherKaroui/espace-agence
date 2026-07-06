import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Users2, Plus, MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { createInternalConversation, listAllowedInternalContacts } from "@/lib/internal-messages.functions";
import { roleLabelFr } from "@/lib/role-labels";

export const Route = createFileRoute("/_authenticated/admin/internal-messages/")({
  head: () => ({ meta: [{ title: "Messagerie interne" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const ok = roles?.some((r) => ["admin", "direction", "manager", "consultant"].includes(r.role));
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: InternalMessagesIndex,
});

function InternalMessagesIndex() {
  const { user } = useAuth();

  // Conversations dont je suis membre — RLS s'en assure côté serveur
  const { data: convs = [] } = useQuery({
    queryKey: ["internal-conversations", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: memberships } = await supabase
        .from("internal_conversation_members")
        .select("conversation_id, last_read_at")
        .eq("user_id", user!.id);
      const ids = (memberships ?? []).map((m: any) => m.conversation_id);
      if (ids.length === 0) return [];
      const { data: conversations } = await supabase
        .from("internal_conversations")
        .select("*")
        .in("id", ids)
        .order("updated_at", { ascending: false });
      const { data: allMembers } = await supabase
        .from("internal_conversation_members")
        .select("conversation_id, user_id")
        .in("conversation_id", ids);
      const memberIds = Array.from(new Set((allMembers ?? []).map((m: any) => m.user_id)));
      const { data: profiles } = memberIds.length
        ? await supabase.from("profiles").select("id, prenom, nom, email").in("id", memberIds)
        : { data: [] as any[] };
      const profById = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      return (conversations ?? []).map((c: any) => {
        const others = (allMembers ?? [])
          .filter((m: any) => m.conversation_id === c.id && m.user_id !== user!.id)
          .map((m: any) => profById.get(m.user_id))
          .filter(Boolean);
        return { ...c, others };
      });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Messagerie interne</h1>
          <p className="text-muted-foreground mt-1">Conversations privées entre membres de l'agence.</p>
        </div>
        <NewInternalConversationDialog />
      </div>

      {convs.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground text-sm">
          <MessageSquare className="h-6 w-6 mx-auto mb-2 opacity-60" />
          Aucune conversation. Créez-en une avec un membre de vos pôles ou avec la direction.
        </Card>
      ) : (
        <Card className="divide-y">
          {convs.map((c: any) => (
            <Link
              key={c.id}
              to="/admin/internal-messages/$id"
              params={{ id: c.id }}
              className="flex items-center gap-3 p-4 hover:bg-muted/30"
            >
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Users2 className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {c.titre ||
                    (c.others.length > 0
                      ? c.others.map((o: any) => `${o.prenom ?? ""} ${o.nom ?? ""}`.trim() || o.email).join(", ")
                      : "Conversation")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {c.is_group ? "Groupe" : "Discussion directe"} · {c.others.length} participant{c.others.length > 1 ? "s" : ""}
                </div>
              </div>
              {c.updated_at && (
                <div className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(c.updated_at), { addSuffix: true, locale: fr })}
                </div>
              )}
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

function NewInternalConversationDialog() {
  const qc = useQueryClient();
  const createFn = useServerFn(createInternalConversation);
  const listFn = useServerFn(listAllowedInternalContacts);
  const [open, setOpen] = useState(false);
  const [titre, setTitre] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");

  const { data: contacts = [] } = useQuery({
    queryKey: ["internal-contacts"],
    enabled: open,
    queryFn: async () => (await listFn()) as any[],
  });

  const filtered = contacts.filter((c: any) => {
    const s = `${c.prenom} ${c.nom} ${c.email}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  const create = useMutation({
    mutationFn: async () =>
      createFn({
        data: { memberIds: Array.from(selected), titre: titre || undefined },
      }),
    onSuccess: () => {
      toast.success("Conversation créée");
      setOpen(false);
      setSelected(new Set());
      setTitre("");
      qc.invalidateQueries({ queryKey: ["internal-conversations"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-2" /> Nouvelle conversation
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle conversation interne</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="int-titre">Titre (optionnel — utile pour un groupe)</Label>
            <Input id="int-titre" value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Ex. Coordination BPF" />
          </div>
          <div>
            <Label>Membres</Label>
            <Input placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />
            <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
              {filtered.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">Aucun contact disponible dans vos pôles.</div>
              ) : (
                filtered.map((c: any) => {
                  const label = `${c.prenom ?? ""} ${c.nom ?? ""}`.trim() || c.email;
                  const roleTags = (c.roles as string[]).map(roleLabelFr).join(", ");
                  return (
                    <label key={c.id} className="flex items-center gap-3 p-2 hover:bg-muted/30 cursor-pointer">
                      <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{label}</div>
                        <div className="text-xs text-muted-foreground truncate">{roleTags || c.email}</div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={selected.size === 0 || create.isPending}
          >
            {create.isPending ? "Création…" : "Créer la conversation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

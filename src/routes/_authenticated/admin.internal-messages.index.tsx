import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Users2, Plus, MessageSquare, Star, Users, Search, Archive, Megaphone, Hash, Lock, Trash2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import {
  createInternalConversation,
  createInternalGroup,
  listAllowedInternalContacts,
} from "@/lib/internal-messages.functions";
import { roleLabelFr } from "@/lib/role-labels";
import { cn } from "@/lib/utils";
import { mentionsToPlainText } from "@/lib/mentions";


// Types de conversations affichés dans la messagerie interne.
// Les anciennes conversations "client", "dossier", "task" sont volontairement exclues :
// la messagerie interne ne concerne QUE l'équipe.
const INTERNAL_TYPES = ["direct", "group", "channel", "pole", "announcement", "custom"] as const;

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
  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 min-h-[calc(100vh-8rem)]">
      <InternalConversationsSidebar activeId={null} />
      <Card className="hidden md:flex items-center justify-center p-10 text-center text-sm text-muted-foreground">
        <div>
          <MessageSquare className="h-8 w-8 mx-auto mb-3 opacity-60" />
          <p>Sélectionnez une conversation à gauche ou démarrez-en une nouvelle.</p>
          <p className="mt-1 text-xs">Messagerie interne : uniquement pour l'équipe de l'agence.</p>
        </div>
      </Card>
    </div>
  );
}

// -------- Sidebar réutilisée par les 2 routes --------

export function InternalConversationsSidebar({ activeId }: { activeId: string | null }) {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const { data: convs = [], isLoading } = useQuery({
    queryKey: ["internal-conversations-full", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // Toutes les conversations que je peux voir (RLS étendu)
      const { data: conversations } = await supabase
        .from("internal_conversations")
        .select("*")
        .in("type", INTERNAL_TYPES as unknown as string[])
        .order("updated_at", { ascending: false });
      const ids = (conversations ?? []).map((c: any) => c.id);
      if (ids.length === 0) return [] as any[];

      const [{ data: myMemberships }, { data: allMembers }, { data: lastMsgs }] = await Promise.all([
        supabase
          .from("internal_conversation_members")
          .select("conversation_id, last_read_at, favorite, muted")
          .eq("user_id", user!.id)
          .in("conversation_id", ids),
        supabase
          .from("internal_conversation_members")
          .select("conversation_id, user_id, role")
          .in("conversation_id", ids),
        supabase
          .from("internal_messages")
          .select("conversation_id, content, sender_id, created_at, attachment_name")
          .in("conversation_id", ids)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

      const memberIds = Array.from(new Set(((allMembers ?? []) as any[]).map((m) => m.user_id)));
      const { data: profiles } = memberIds.length
        ? await supabase.from("profiles").select("id, prenom, nom, email").in("id", memberIds)
        : { data: [] as any[] };
      const profById = new Map(((profiles ?? []) as any[]).map((p) => [p.id, p]));

      const mineById = new Map(
        ((myMemberships ?? []) as any[]).map((m) => [m.conversation_id, m]),
      );
      const lastByConv = new Map<string, any>();
      for (const m of (lastMsgs ?? []) as any[]) {
        if (!lastByConv.has(m.conversation_id)) lastByConv.set(m.conversation_id, m);
      }

      return (conversations ?? []).map((c: any) => {
        const membersOfConv = ((allMembers ?? []) as any[])
          .filter((m) => m.conversation_id === c.id)
          .map((m) => ({ ...m, profile: profById.get(m.user_id) }));
        const others = membersOfConv.filter((m) => m.user_id !== user!.id);
        const mine = mineById.get(c.id);
        const lastMsg = lastByConv.get(c.id);
        const lastAt = lastMsg?.created_at ?? c.updated_at;
        const unread =
          lastMsg &&
          lastMsg.sender_id !== user!.id &&
          (!mine?.last_read_at || new Date(lastMsg.created_at) > new Date(mine.last_read_at));
        return {
          ...c,
          others,
          members: membersOfConv,
          lastMsg,
          lastAt,
          unread: !!unread,
          favorite: !!mine?.favorite,
          muted: !!mine?.muted,
          isMember: !!mine,
        };
      });
    },
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return convs.filter((c: any) => {
      if (!showArchived && c.archived_at) return false;
      if (showArchived && !c.archived_at) return false;
      if (!term) return true;
      const membersStr = c.others
        .map((o: any) => `${o.profile?.prenom ?? ""} ${o.profile?.nom ?? ""} ${o.profile?.email ?? ""}`)
        .join(" ");
      return (`${c.titre ?? ""} ${membersStr}`).toLowerCase().includes(term);
    });
  }, [convs, q, showArchived]);

  const groups: { key: string; label: string; icon: any; items: any[] }[] = [
    { key: "fav", label: "Favoris", icon: Star, items: filtered.filter((c: any) => c.favorite) },
    { key: "unread", label: "Non lus", icon: MessageSquare, items: filtered.filter((c: any) => c.unread && !c.favorite) },
    { key: "direct", label: "Messages directs", icon: Users2, items: filtered.filter((c: any) => c.type === "direct" && !c.favorite && !c.unread) },
    { key: "pole", label: "Pôles", icon: Users, items: filtered.filter((c: any) => c.type === "pole" && !c.favorite && !c.unread) },
    { key: "channel", label: "Canaux", icon: Hash, items: filtered.filter((c: any) => c.type === "channel" && !c.favorite && !c.unread) },
    { key: "group", label: "Groupes internes", icon: Users2, items: filtered.filter((c: any) => (c.type === "group" || c.type === "custom") && !c.favorite && !c.unread) },
    { key: "announcement", label: "Annonces", icon: Megaphone, items: filtered.filter((c: any) => c.type === "announcement" && !c.favorite && !c.unread) },
  ].filter((g) => g.items.length > 0);

  const totalUnread = convs.filter((c: any) => c.unread).length;

  return (
    <Card className="flex flex-col overflow-hidden max-h-[calc(100vh-8rem)]">
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="font-display text-lg leading-tight">Messagerie interne</h1>
            <p className="text-xs text-muted-foreground">
              {convs.length} conversation{convs.length > 1 ? "s" : ""}
              {totalUnread > 0 && (
                <> · <span className="text-primary font-medium">{totalUnread} non lu{totalUnread > 1 ? "s" : ""}</span></>
              )}
            </p>
          </div>
          <NewInternalConversationDialog />
        </div>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            className="pl-8 h-9"
            placeholder="Rechercher…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => setShowArchived(false)}
            className={cn(
              "px-2 py-1 rounded-md",
              !showArchived ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            Actives
          </button>
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className={cn(
              "px-2 py-1 rounded-md inline-flex items-center gap-1",
              showArchived ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            <Archive className="h-3 w-3" /> Archivées
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="p-4 text-xs text-muted-foreground">Chargement…</p>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="p-6 text-center text-xs text-muted-foreground">
            <MessageSquare className="h-5 w-5 mx-auto mb-2 opacity-60" />
            {showArchived ? "Aucune conversation archivée." : "Aucune conversation. Créez-en une ou ouvrez-en depuis un client, dossier ou tâche."}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.key}>
            <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
              <g.icon className="h-3 w-3" /> {g.label}
              <span className="ml-1 text-muted-foreground/70">{g.items.length}</span>
            </div>
            <ul>
              {g.items.map((c: any) => (
                <ConversationRow key={c.id} conv={c} activeId={activeId} currentUserId={user?.id ?? null} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ConversationRow({
  conv, activeId, currentUserId,
}: { conv: any; activeId: string | null; currentUserId: string | null }) {
  const isActive = conv.id === activeId;
  const title = conversationDisplayTitle(conv, currentUserId);
  const previewText = mentionsToPlainText(conv.lastMsg?.content);
  const preview = previewText
    ? previewText
    : conv.lastMsg?.attachment_name
    ? `📎 ${conv.lastMsg.attachment_name}`
    : "Aucun message";

  return (
    <li>
      <Link
        to="/admin/internal-messages/$id"
        params={{ id: conv.id }}
        className={cn(
          "flex items-start gap-2.5 px-3 py-2.5 border-b last:border-b-0 hover:bg-muted/40 transition-colors",
          isActive && "bg-primary/5 border-l-2 border-l-primary",
        )}
      >
        <ConversationAvatar conv={conv} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className={cn("text-sm truncate", conv.unread ? "font-semibold" : "font-medium")}>
              {title}
            </div>
            {conv.favorite && <Star className="h-3 w-3 fill-warning text-warning shrink-0" />}
          </div>
          <div className="text-xs text-muted-foreground truncate">{preview}</div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {conv.lastAt && (
            <div className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(conv.lastAt), { addSuffix: true, locale: fr })}
            </div>
          )}
          {conv.unread && <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />}
        </div>
      </Link>
    </li>
  );
}

function ConversationAvatar({ conv }: { conv: any }) {
  const map: Record<string, { icon: any; cls: string }> = {
    pole: { icon: Users, cls: "bg-gold/15 text-gold" },
    channel: { icon: Hash, cls: "bg-primary/15 text-primary" },
    group: { icon: Users2, cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
    announcement: { icon: Megaphone, cls: "bg-warning/15 text-warning-foreground" },
    direct: { icon: Users2, cls: "bg-primary/10 text-primary" },
    custom: { icon: MessageSquare, cls: "bg-muted text-muted-foreground" },
  };
  const spec = map[conv.type] ?? map.custom;
  const Icon = spec.icon;
  return (
    <div className={cn("h-9 w-9 rounded-full flex items-center justify-center shrink-0", spec.cls)}>
      <Icon className="h-4 w-4" />
    </div>
  );
}

export function conversationDisplayTitle(conv: any, currentUserId: string | null): string {
  if (conv.titre) return conv.titre;
  const others = (conv.others ?? []).filter((m: any) => m.user_id !== currentUserId);
  if (others.length > 0) {
    return others
      .map((o: any) =>
        `${o.profile?.prenom ?? ""} ${o.profile?.nom ?? ""}`.trim() || o.profile?.email || "Membre",
      )
      .join(", ");
  }
  return "Conversation";
}

// -------- Boîte de dialogue "Nouvelle" : discussion directe / groupe / canal --------

function NewInternalConversationDialog() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { user } = useAuth();
  const createDirectFn = useServerFn(createInternalConversation);
  const createGroupFn = useServerFn(createInternalGroup);
  const listFn = useServerFn(listAllowedInternalContacts);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"direct" | "group">("direct");

  // Rôle courant
  const { data: myRoles = [] } = useQuery({
    queryKey: ["my-roles", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user!.id);
      return ((data ?? []) as any[]).map((r) => r.role);
    },
  });
  const canCreateGroup = myRoles.includes("admin") || myRoles.includes("direction");

  const { data: contacts = [] } = useQuery({
    queryKey: ["internal-contacts"],
    enabled: open,
    queryFn: async () => (await listFn()) as any[],
  });

  const { data: poles = [] } = useQuery({
    queryKey: ["poles-for-int-msg"],
    enabled: open && canCreateGroup,
    queryFn: async () => {
      const { data } = await supabase.from("poles").select("id, nom, couleur, actif").eq("actif", true).order("nom");
      return data ?? [];
    },
  });

  // --- Mode "Direct / Groupe rapide" ---
  const [directTitre, setDirectTitre] = useState("");
  const [directSelected, setDirectSelected] = useState<Set<string>>(new Set());
  const [directQuery, setDirectQuery] = useState("");

  const filteredContacts = contacts.filter((c: any) => {
    const s = `${c.prenom} ${c.nom} ${c.email}`.toLowerCase();
    return s.includes(directQuery.toLowerCase());
  });

  const createDirect = useMutation({
    mutationFn: () =>
      createDirectFn({ data: { memberIds: Array.from(directSelected), titre: directTitre || undefined } }),
    onSuccess: (r: any) => {
      toast.success("Conversation créée");
      setOpen(false);
      setDirectSelected(new Set());
      setDirectTitre("");
      qc.invalidateQueries({ queryKey: ["internal-conversations-full"] });
      nav({ to: "/admin/internal-messages/$id", params: { id: r.id } });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  // --- Mode "Nouveau groupe / canal" ---
  const [gTitre, setGTitre] = useState("");
  const [gDescription, setGDescription] = useState("");
  const [gType, setGType] = useState<"group" | "channel" | "pole" | "announcement">("group");
  const [gIsPrivate, setGIsPrivate] = useState(false);
  const [gAdminOnly, setGAdminOnly] = useState(false);
  const [gPoleId, setGPoleId] = useState<string | null>(null);
  const [gMembers, setGMembers] = useState<Set<string>>(new Set());
  const [gQuery, setGQuery] = useState("");

  const gFilteredContacts = contacts.filter((c: any) => {
    const s = `${c.prenom} ${c.nom} ${c.email}`.toLowerCase();
    return s.includes(gQuery.toLowerCase());
  });

  const createGroup = useMutation({
    mutationFn: () =>
      createGroupFn({
        data: {
          titre: gTitre.trim(),
          description: gDescription.trim() || undefined,
          type: gType,
          isPrivate: gIsPrivate,
          adminOnlyPosting: gAdminOnly,
          poleId: gType === "pole" ? gPoleId : null,
          memberIds: Array.from(gMembers),
        },
      }),
    onSuccess: (r: any) => {
      toast.success(gType === "announcement" ? "Canal d'annonces créé" : "Groupe créé");
      setOpen(false);
      setGTitre("");
      setGDescription("");
      setGType("group");
      setGIsPrivate(false);
      setGAdminOnly(false);
      setGPoleId(null);
      setGMembers(new Set());
      qc.invalidateQueries({ queryKey: ["internal-conversations-full"] });
      nav({ to: "/admin/internal-messages/$id", params: { id: r.id } });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const toggle = (setter: (fn: (s: Set<string>) => Set<string>) => void) => (id: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1">
          <Plus className="h-4 w-4" /> Nouvelle
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouvelle conversation interne</DialogTitle>
        </DialogHeader>

        {/* Onglets */}
        <div className="flex gap-1 border-b -mt-2">
          <button
            type="button"
            onClick={() => setTab("direct")}
            className={cn(
              "px-3 py-1.5 text-sm border-b-2",
              tab === "direct" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Message direct / groupe rapide
          </button>
          {canCreateGroup && (
            <button
              type="button"
              onClick={() => setTab("group")}
              className={cn(
                "px-3 py-1.5 text-sm border-b-2",
                tab === "group" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              Nouveau groupe / canal
            </button>
          )}
        </div>

        {tab === "direct" && (
          <div className="space-y-2">
            <Input
              value={directTitre}
              onChange={(e) => setDirectTitre(e.target.value)}
              placeholder="Titre (optionnel — utile pour un groupe)"
            />
            <Input
              placeholder="Rechercher un contact…"
              value={directQuery}
              onChange={(e) => setDirectQuery(e.target.value)}
            />
            <div className="max-h-60 overflow-y-auto rounded-md border divide-y">
              {filteredContacts.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">Aucun contact disponible.</div>
              ) : (
                filteredContacts.map((c: any) => {
                  const label = `${c.prenom ?? ""} ${c.nom ?? ""}`.trim() || c.email;
                  const roleTags = (c.roles as string[]).map(roleLabelFr).join(", ");
                  return (
                    <label key={c.id} className="flex items-center gap-3 p-2 hover:bg-muted/30 cursor-pointer">
                      <Checkbox
                        checked={directSelected.has(c.id)}
                        onCheckedChange={() => toggle(setDirectSelected)(c.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{label}</div>
                        <div className="text-xs text-muted-foreground truncate">{roleTags || c.email}</div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
            {directSelected.size > 0 && (
              <Badge variant="secondary">
                {directSelected.size} personne{directSelected.size > 1 ? "s" : ""} sélectionnée{directSelected.size > 1 ? "s" : ""}
              </Badge>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
              <Button
                onClick={() => createDirect.mutate()}
                disabled={directSelected.size === 0 || createDirect.isPending}
              >
                {createDirect.isPending ? "Création…" : "Créer la conversation"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {tab === "group" && canCreateGroup && (
          <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
            <div>
              <Label>Nom du groupe / canal</Label>
              <Input value={gTitre} onChange={(e) => setGTitre(e.target.value)} placeholder="Ex : Direction, BPF, Annonces internes" />
            </div>
            <div>
              <Label>Description (optionnel)</Label>
              <Textarea rows={2} value={gDescription} onChange={(e) => setGDescription(e.target.value)} />
            </div>
            <div>
              <Label>Type</Label>
              <RadioGroup value={gType} onValueChange={(v: any) => setGType(v)} className="grid grid-cols-2 gap-2 mt-1">
                <label className="flex items-start gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/30">
                  <RadioGroupItem value="group" className="mt-0.5" />
                  <div>
                    <div className="text-sm font-medium flex items-center gap-1"><Users2 className="h-3.5 w-3.5" /> Groupe privé</div>
                    <div className="text-[11px] text-muted-foreground">Sur invitation</div>
                  </div>
                </label>
                <label className="flex items-start gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/30">
                  <RadioGroupItem value="channel" className="mt-0.5" />
                  <div>
                    <div className="text-sm font-medium flex items-center gap-1"><Hash className="h-3.5 w-3.5" /> Canal public interne</div>
                    <div className="text-[11px] text-muted-foreground">Ouvert à l'équipe</div>
                  </div>
                </label>
                <label className="flex items-start gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/30">
                  <RadioGroupItem value="pole" className="mt-0.5" />
                  <div>
                    <div className="text-sm font-medium flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Canal de pôle</div>
                    <div className="text-[11px] text-muted-foreground">Membres du pôle</div>
                  </div>
                </label>
                <label className="flex items-start gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/30">
                  <RadioGroupItem value="announcement" className="mt-0.5" />
                  <div>
                    <div className="text-sm font-medium flex items-center gap-1"><Megaphone className="h-3.5 w-3.5" /> Annonces direction</div>
                    <div className="text-[11px] text-muted-foreground">Écriture admin uniquement</div>
                  </div>
                </label>
              </RadioGroup>
            </div>

            {gType === "pole" && (
              <div>
                <Label>Pôle associé</Label>
                <Select value={gPoleId ?? ""} onValueChange={(v) => setGPoleId(v || null)}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner un pôle" /></SelectTrigger>
                  <SelectContent>
                    {poles.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.nom}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={gIsPrivate}
                  onCheckedChange={(v) => setGIsPrivate(!!v)}
                />
                <Lock className="h-3.5 w-3.5" />
                Privé (sur invitation uniquement)
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={gAdminOnly || gType === "announcement"}
                  disabled={gType === "announcement"}
                  onCheckedChange={(v) => setGAdminOnly(!!v)}
                />
                Écriture réservée aux admins / direction
              </label>
            </div>

            <div>
              <Label>Ajouter des membres</Label>
              <Input
                placeholder="Rechercher un contact…"
                value={gQuery}
                onChange={(e) => setGQuery(e.target.value)}
                className="mt-1"
              />
              <div className="max-h-40 overflow-y-auto rounded-md border divide-y mt-1">
                {gFilteredContacts.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground text-center">Aucun contact.</div>
                ) : (
                  gFilteredContacts.map((c: any) => {
                    const label = `${c.prenom ?? ""} ${c.nom ?? ""}`.trim() || c.email;
                    return (
                      <label key={c.id} className="flex items-center gap-3 p-2 hover:bg-muted/30 cursor-pointer">
                        <Checkbox
                          checked={gMembers.has(c.id)}
                          onCheckedChange={() => toggle(setGMembers)(c.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{label}</div>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Les admins et la direction sont ajoutés automatiquement.
              </p>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
              <Button
                onClick={() => createGroup.mutate()}
                disabled={!gTitre.trim() || (gType === "pole" && !gPoleId) || createGroup.isPending}
              >
                {createGroup.isPending ? "Création…" : "Créer"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

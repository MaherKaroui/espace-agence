import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Users2, Plus, ChevronRight, ChevronDown, MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import {
  useClientsActivity, mergeActivity, ActivityBadges, type ClientActivity,
} from "@/components/conversation-activity";


export const Route = createFileRoute("/_authenticated/messages/groupes/")({
  head: () => ({ meta: [{ title: "Groupes de discussion" }] }),
  component: GroupesIndex,
});

type Conv = {
  id: string;
  titre: string;
  parent_id: string | null;
  created_by: string;
  updated_at: string;
};

function GroupesIndex() {
  const { user } = useAuth();
  const { isStaff, isAdmin } = useRole();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: myMemberships = [] } = useQuery({
    queryKey: ["my-conv-memberships", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.conversation_id);
    },
  });

  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations-list", isAdmin ? "all" : myMemberships.join(",")],
    enabled: isAdmin || myMemberships.length >= 0,
    queryFn: async () => {
      let q = supabase
        .from("conversations")
        .select("id, titre, parent_id, created_by, updated_at")
        .order("updated_at", { ascending: false });
      if (!isAdmin) {
        if (myMemberships.length === 0) return [] as Conv[];
        q = q.in("id", myMemberships);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Conv[];
    },
  });

  // Unread counts per conversation (based on notifications table)
  const { data: unreadByConv = {} } = useQuery({
    queryKey: ["group-unread-per-conv", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("notifications")
        .select("link")
        .eq("user_id", user!.id)
        .is("read_at", null)
        .like("link", "/messages/groupes/%");
      const map: Record<string, number> = {};
      for (const n of (data ?? []) as { link: string | null }[]) {
        const id = (n.link ?? "").split("/messages/groupes/")[1];
        if (id) map[id] = (map[id] ?? 0) + 1;
      }
      return map;
    },
  });

  // Membres de chaque groupe → permet d'agréger l'activité (dossiers, tâches,
  // demandes, documents) des clients présents dans la conversation.
  const convIds = useMemo(() => conversations.map((c) => c.id), [conversations]);
  const { data: membersByConv = {} } = useQuery({
    queryKey: ["group-members-map", convIds.join(",")],
    enabled: convIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("conversation_members")
        .select("conversation_id, user_id")
        .in("conversation_id", convIds);
      const map: Record<string, string[]> = {};
      for (const r of (data ?? []) as { conversation_id: string; user_id: string }[]) {
        (map[r.conversation_id] ??= []).push(r.user_id);
      }
      return map;
    },
  });
  const allMemberIds = useMemo(
    () => Array.from(new Set(Object.values(membersByConv).flat())),
    [membersByConv],
  );
  const { data: activityByUser } = useClientsActivity(allMemberIds);
  const activityByConv = useMemo(() => {
    const map: Record<string, ClientActivity> = {};
    if (!activityByUser) return map;
    for (const [cid, uids] of Object.entries(membersByConv)) {
      map[cid] = mergeActivity(uids.map((u) => activityByUser.get(u)));
    }
    return map;
  }, [membersByConv, activityByUser]);

  const tree = useMemo(() => buildTree(conversations), [conversations]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">Groupes de discussion</h1>
          <p className="text-muted-foreground mt-1">
            {isStaff
              ? "Créez un groupe pour discuter à plusieurs, avec sous-groupes en arborescence."
              : "Retrouvez ici les groupes auxquels l'agence vous a ajouté."}
          </p>
        </div>
        {isAdmin ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-1" /> Nouveau groupe</Button>
            </DialogTrigger>
            <CreateGroupDialog
              onCreated={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["my-conv-memberships"] }); qc.invalidateQueries({ queryKey: ["conversations-list"] }); }}
            />
          </Dialog>
        ) : !isStaff ? (
          <Button asChild variant="outline">
            <Link to="/messages"><MessageSquare className="h-4 w-4 mr-1" /> Contacter l'agence</Link>
          </Button>
        ) : null}
      </div>


      <Card className="p-4">
        {conversations.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            <Users2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Vous n'êtes membre d'aucun groupe pour le moment.
          </div>
        ) : (
          <ul className="space-y-1">
            {tree.map((node) => <TreeNode key={node.id} node={node} depth={0} unreadByConv={unreadByConv} activityByConv={activityByConv} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}

type Node = Conv & { children: Node[] };

// Sum unread count for a subtree (this node + descendants) so a parent
// badge signals activity in any sub-group.
function subtreeUnread(node: Node, map: Record<string, number>): number {
  let s = map[node.id] ?? 0;
  for (const c of node.children) s += subtreeUnread(c, map);
  return s;
}

function buildTree(list: Conv[]): Node[] {
  const map = new Map<string, Node>();
  list.forEach((c) => map.set(c.id, { ...c, children: [] }));
  const roots: Node[] = [];
  map.forEach((n) => {
    if (n.parent_id && map.has(n.parent_id)) map.get(n.parent_id)!.children.push(n);
    else roots.push(n);
  });
  return roots;
}

function TreeNode({ node, depth, unreadByConv, activityByConv }: {
  node: Node; depth: number; unreadByConv: Record<string, number>;
  activityByConv: Record<string, ClientActivity>;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const ownUnread = unreadByConv[node.id] ?? 0;
  const subUnread = hasChildren ? subtreeUnread(node, unreadByConv) - ownUnread : 0;
  return (
    <li>
      <div className="flex items-center gap-1 rounded-md hover:bg-muted/50" style={{ paddingLeft: depth * 20 }}>
        {hasChildren ? (
          <button className="p-1" onClick={() => setExpanded((e) => !e)}>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-6" />
        )}
        <Link
          to="/messages/groupes/$id"
          params={{ id: node.id }}
          className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-2 px-2 py-2 text-sm"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Users2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className={`truncate min-w-0 ${ownUnread > 0 ? "font-semibold" : "font-medium"}`}>{node.titre}</span>
            {ownUnread > 0 && (
              <span className="h-5 min-w-5 px-1.5 rounded-full bg-gold text-[10px] font-semibold text-primary flex items-center justify-center shrink-0">
                {ownUnread > 99 ? "99+" : ownUnread}
              </span>
            )}
            {!expanded && subUnread > 0 && (
              <span
                title={`${subUnread} non lu${subUnread > 1 ? "s" : ""} dans les sous-groupes`}
                className="h-5 min-w-5 px-1.5 rounded-full bg-muted text-[10px] font-semibold text-foreground flex items-center justify-center shrink-0"
              >
                +{subUnread}
              </span>
            )}
          </span>
          <span className="flex items-center gap-2 shrink-0 pl-6 sm:pl-0 sm:ml-2">
            <ActivityBadges activity={activityByConv[node.id]} />
            <span className="text-[11px] sm:text-xs text-muted-foreground truncate">
              {formatDistanceToNow(new Date(node.updated_at), { locale: fr, addSuffix: true })}
            </span>
          </span>
        </Link>

      </div>
      {hasChildren && expanded && (
        <ul>
          {node.children.map((c) => <TreeNode key={c.id} node={c} depth={depth + 1} unreadByConv={unreadByConv} activityByConv={activityByConv} />)}
        </ul>
      )}
    </li>
  );
}

export function CreateGroupDialog({
  parentId,
  onCreated,
}: {
  parentId?: string;
  onCreated: (newId: string) => void;
}) {
  const { user } = useAuth();
  const [titre, setTitre] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const { data: people = [] } = useQuery({
    queryKey: ["profiles-search", search],
    queryFn: async () => {
      let q = supabase.from("profiles").select("id, prenom, nom, email").limit(50);
      if (search.trim()) {
        const s = `%${search.trim()}%`;
        q = q.or(`prenom.ilike.${s},nom.ilike.${s},email.ilike.${s}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).filter((p: any) => p.id !== user?.id);
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const create = async () => {
    if (!titre.trim()) return toast.error("Titre requis");
    setBusy(true);
    try {
      const { data: conv, error } = await supabase
        .from("conversations")
        .insert({ titre: titre.trim(), parent_id: parentId ?? null, created_by: user!.id })
        .select("id")
        .single();
      if (error) throw error;
      const members = [
        { conversation_id: conv.id, user_id: user!.id, role: "owner" as const },
        ...Array.from(selected).map((uid) => ({ conversation_id: conv.id, user_id: uid, role: "member" as const })),
      ];
      const { error: mErr } = await supabase.from("conversation_members").insert(members);
      if (mErr) throw mErr;
      toast.success("Groupe créé");
      void import("@/lib/email/notify-group").then((m) =>
        m.notifyGroupMembersAdded("client", conv.id, Array.from(selected), titre.trim()),
      );
      setTitre(""); setSelected(new Set());
      onCreated(conv.id);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{parentId ? "Nouveau sous-groupe" : "Nouveau groupe"}</DialogTitle>
        <DialogDescription>Donnez un titre et choisissez les participants.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label>Titre du groupe</Label>
          <Input value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Ex : Équipe projet Alpha" />
        </div>
        <div>
          <Label>Ajouter des membres</Label>
          <Input placeholder="Rechercher un nom ou e-mail…" value={search} onChange={(e) => setSearch(e.target.value)} className="mt-1" />
          <div className="mt-2 max-h-64 overflow-y-auto border rounded-md divide-y">
            {people.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">Aucun contact trouvé.</div>
            ) : (
              people.map((p: any) => {
                const label = `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email;
                return (
                  <label key={p.id} className="flex items-center gap-3 p-2 cursor-pointer hover:bg-muted/50 text-sm">
                    <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                    <div className="min-w-0">
                      <div className="truncate">{label}</div>
                      <div className="text-xs text-muted-foreground truncate">{p.email}</div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{selected.size} sélectionné(s) — vous serez automatiquement ajouté comme propriétaire.</p>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={create} disabled={busy || !titre.trim()}>Créer le groupe</Button>
      </DialogFooter>
    </DialogContent>
  );
}

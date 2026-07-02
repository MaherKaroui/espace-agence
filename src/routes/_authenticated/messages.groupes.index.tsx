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
  const { isStaff } = useRole();
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
    queryKey: ["conversations-list", myMemberships],
    enabled: myMemberships.length >= 0,
    queryFn: async () => {
      if (myMemberships.length === 0) return [] as Conv[];
      const { data, error } = await supabase
        .from("conversations")
        .select("id, titre, parent_id, created_by, updated_at")
        .in("id", myMemberships)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Conv[];
    },
  });

  const tree = useMemo(() => buildTree(conversations), [conversations]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">Groupes de discussion</h1>
          <p className="text-muted-foreground mt-1">Créez un groupe pour discuter à plusieurs, avec sous-groupes en arborescence.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" /> Nouveau groupe</Button>
          </DialogTrigger>
          <CreateGroupDialog
            onCreated={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["my-conv-memberships"] }); qc.invalidateQueries({ queryKey: ["conversations-list"] }); }}
          />
        </Dialog>
      </div>

      <Card className="p-4">
        {conversations.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            <Users2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Vous n'êtes membre d'aucun groupe pour le moment.
          </div>
        ) : (
          <ul className="space-y-1">
            {tree.map((node) => <TreeNode key={node.id} node={node} depth={0} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}

type Node = Conv & { children: Node[] };

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

function TreeNode({ node, depth }: { node: Node; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
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
          className="flex-1 flex items-center justify-between px-2 py-2 text-sm"
        >
          <span className="flex items-center gap-2">
            <Users2 className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{node.titre}</span>
          </span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(node.updated_at), { locale: fr, addSuffix: true })}
          </span>
        </Link>
      </div>
      {hasChildren && expanded && (
        <ul>
          {node.children.map((c) => <TreeNode key={c.id} node={c} depth={depth + 1} />)}
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

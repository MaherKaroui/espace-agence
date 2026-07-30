import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ArrowLeft, Plus, UserMinus, UserPlus, Trash2, Users } from "lucide-react";
import { EphemeralSettingsButton, EphemeralBanner } from "@/components/ephemeral-mode";
import { GroupChatWindow } from "@/components/group-chat-window";
import { CreateGroupDialog } from "./messages.groupes.index";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/messages/groupes/$id")({
  head: () => ({ meta: [{ title: "Groupe de discussion" }] }),
  component: GroupePage,
});

function GroupePage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [openSub, setOpenSub] = useState(false);
  const [openAdd, setOpenAdd] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());

  const { data: conv } = useQuery({
    queryKey: ["conversation", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("conversations").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: members = [] } = useQuery({
    queryKey: ["conversation-members", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversation_members")
        .select("user_id, role")
        .eq("conversation_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const memberIds = members.map((m: any) => m.user_id);
  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-in", memberIds],
    enabled: memberIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, prenom, nom, email").in("id", memberIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const nameFor = (uid: string) => {
    const p: any = profiles.find((x: any) => x.id === uid);
    if (!p) return uid.slice(0, 8);
    return `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email;
  };
  const memberNames = useMemo(() => {
    const map: Record<string, string> = {};
    memberIds.forEach((uid) => { map[uid] = nameFor(uid); });
    return map;
  }, [memberIds, profiles]);

  const isOwner = members.some((m: any) => m.user_id === user?.id && m.role === "owner");
  const canManage = isOwner || isAdmin;

  const { data: available = [] } = useQuery({
    queryKey: ["profiles-add-search", id, addSearch, memberIds],
    enabled: openAdd,
    queryFn: async () => {
      let q = supabase.from("profiles").select("id, prenom, nom, email").limit(50);
      if (addSearch.trim()) {
        const s = `%${addSearch.trim()}%`;
        q = q.or(`prenom.ilike.${s},nom.ilike.${s},email.ilike.${s}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).filter((p: any) => !memberIds.includes(p.id));
    },
  });

  const addMembers = async () => {
    if (addSelected.size === 0) return;
    const rows = Array.from(addSelected).map((uid) => ({ conversation_id: id, user_id: uid, role: "member" as const }));
    const { error } = await supabase.from("conversation_members").insert(rows);
    if (error) return toast.error(error.message);
    toast.success("Membres ajoutés");
    setAddSelected(new Set());
    setOpenAdd(false);
    qc.invalidateQueries({ queryKey: ["conversation-members", id] });
  };

  const removeMember = async (uid: string) => {
    const { error } = await supabase.from("conversation_members").delete().eq("conversation_id", id).eq("user_id", uid);
    if (error) return toast.error(error.message);
    toast.success("Membre retiré");
    qc.invalidateQueries({ queryKey: ["conversation-members", id] });
    if (uid === user?.id) nav({ to: "/messages/groupes" });
  };

  const deleteGroup = async () => {
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Groupe supprimé");
    nav({ to: "/messages/groupes" });
  };

  if (!conv) return <div className="p-8 text-muted-foreground">Chargement…</div>;

  const membersPanel = (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">Membres ({members.length})</h3>
        {canManage && (
          <Dialog open={openAdd} onOpenChange={setOpenAdd}>
            <DialogTrigger asChild>
              <Button size="sm" variant="ghost"><UserPlus className="h-4 w-4" /></Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Ajouter des membres</DialogTitle>
                <DialogDescription>Recherchez et sélectionnez les personnes à ajouter.</DialogDescription>
              </DialogHeader>
              <Input placeholder="Rechercher…" value={addSearch} onChange={(e) => setAddSearch(e.target.value)} />
              <div className="max-h-64 overflow-y-auto border rounded-md divide-y">
                {available.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">Aucun résultat.</div>
                ) : available.map((p: any) => {
                  const label = `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email;
                  return (
                    <label key={p.id} className="flex items-center gap-3 p-2 cursor-pointer hover:bg-muted/50 text-sm">
                      <Checkbox
                        checked={addSelected.has(p.id)}
                        onCheckedChange={() => setAddSelected((prev) => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
                      />
                      <div className="min-w-0">
                        <div className="truncate">{label}</div>
                        <div className="text-xs text-muted-foreground truncate">{p.email}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
              <DialogFooter>
                <Button onClick={addMembers} disabled={addSelected.size === 0}>Ajouter ({addSelected.size})</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <ul className="space-y-1">
        {members.map((m: any) => (
          <li key={m.user_id} className="flex items-center justify-between text-sm rounded p-1 hover:bg-muted/50">
            <div className="min-w-0">
              <div className="truncate">{nameFor(m.user_id)}</div>
              {m.role === "owner" && <div className="text-[10px] uppercase tracking-wider text-gold">Propriétaire</div>}
            </div>
            {(canManage && m.user_id !== user?.id) || m.user_id === user?.id ? (
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeMember(m.user_id)} title="Retirer">
                <UserMinus className="h-3.5 w-3.5 text-destructive" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="pt-3 border-t">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="w-full"><Trash2 className="h-4 w-4 mr-1" /> Supprimer le groupe</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer ce groupe ?</AlertDialogTitle>
                <AlertDialogDescription>Tous les messages et sous-groupes seront supprimés définitivement.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={deleteGroup}>Supprimer</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-chat min-w-0 -mx-3 -mt-3 sm:-mx-5 sm:-mt-5 lg:-mx-8 lg:-mt-8">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-4 py-2 sm:px-6 sm:py-3 border-b bg-background shrink-0">
        <Link to="/messages/groupes" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 shrink-0">
          <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Retour aux groupes</span>
        </Link>
        <div className="min-w-0 text-center">
          <div className="font-display text-base truncate">{conv.titre}</div>
        </div>
        <div className="flex gap-2 shrink-0">
          <EphemeralSettingsButton
            scope={{ kind: "group", conversationId: id }}
            isGroupOwner={isOwner}
          />
          <div className="lg:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Membres">
                  <Users className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[85vw] sm:max-w-sm overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Groupe</SheetTitle>
                </SheetHeader>
                <div className="mt-4">{membersPanel}</div>
              </SheetContent>
            </Sheet>
          </div>
          {isAdmin && (
            <Dialog open={openSub} onOpenChange={setOpenSub}>
              <DialogTrigger asChild>
                <Button variant="outline" size="icon" className="sm:h-9 sm:px-3 sm:w-auto">
                  <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Sous-groupe</span>
                </Button>
              </DialogTrigger>
              <CreateGroupDialog
                parentId={id}
                onCreated={(newId) => { setOpenSub(false); nav({ to: "/messages/groupes/$id", params: { id: newId } }); }}
              />
            </Dialog>
          )}
        </div>
      </div>

      <EphemeralBanner scope={{ kind: "group", conversationId: id }} />

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="hidden lg:grid grid-cols-[1fr_18rem] gap-4 flex-1 min-h-0">
          <GroupChatWindow conversationId={id} title={conv.titre} memberNames={memberNames} className="h-full" />
          <Card className="p-4 h-fit overflow-y-auto">{membersPanel}</Card>
        </div>
        <div className="lg:hidden flex-1 min-h-0">
          <GroupChatWindow conversationId={id} title={conv.titre} memberNames={memberNames} className="h-full" />
        </div>
      </div>
    </div>
  );
}

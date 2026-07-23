import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserPlus, Search, Users, KeyRound, Power, PowerOff, ShieldCheck, MoreVertical, AlertTriangle, Circle, BellRing, BellOff } from "lucide-react";
import { roleLabelFr } from "@/lib/role-labels";
import { cn } from "@/lib/utils";
import {
  listTeam,
  inviteTeamMember,
  updateTeamRole,
  disableTeamMember,
  enableTeamMember,
  resetTeamMemberPassword,
  type TeamMember,
} from "@/lib/team.functions";

export const Route = createFileRoute("/_authenticated/admin/equipe")({
  head: () => ({ meta: [{ title: "Équipe — Direction" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const ok = roles?.some((r) => r.role === "admin" || r.role === "direction");
    if (!ok) throw redirect({ to: "/dashboard" });
    const isAdmin = roles?.some((r) => r.role === "admin") ?? false;
    return { isAdmin };
  },
  component: AdminTeam,
});

const STAFF_ROLES = [
  { value: "admin", label: "Administration" },
  { value: "direction", label: "Direction" },
  { value: "manager", label: "Responsable" },
  { value: "consultant", label: "Collaborateur" },
] as const;

type StaffRole = (typeof STAFF_ROLES)[number]["value"];

function primaryRole(roles: string[]): StaffRole | null {
  const order: StaffRole[] = ["admin", "direction", "manager", "consultant"];
  for (const r of order) if (roles.includes(r)) return r;
  return null;
}

function relativeDate(iso: string | null): string {
  if (!iso) return "Jamais connecté";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 30) return `il y a ${days} j`;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function AdminTeam() {
  const { isAdmin } = Route.useRouteContext();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | StaffRole>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("active");

  const listTeamFn = useServerFn(listTeam);
  const { data: members = [], isLoading, error, refetch } = useQuery({
    queryKey: ["admin-team"],
    queryFn: () => listTeamFn(),
  });

  const { data: poles = [] } = useQuery({
    queryKey: ["admin-team-poles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("poles").select("id, nom, code").eq("actif", true).order("nom");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    return (members ?? []).filter((m) => {
      if (statusFilter === "active" && m.archived_at) return false;
      if (statusFilter === "disabled" && !m.archived_at) return false;
      const pr = primaryRole(m.roles);
      if (roleFilter !== "all" && pr !== roleFilter) return false;
      if (!q.trim()) return true;
      const txt = `${m.email} ${m.prenom ?? ""} ${m.nom ?? ""}`.toLowerCase();
      return txt.includes(q.toLowerCase());
    });
  }, [members, q, roleFilter, statusFilter]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-team"] });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Équipe</h1>
          <p className="text-muted-foreground mt-1">
            {filtered.length} membre{filtered.length > 1 ? "s" : ""}
            {members.filter((m) => m.archived_at).length > 0 && (
              <> · <span className="text-muted-foreground">{members.filter((m) => m.archived_at).length} désactivé{members.filter((m) => m.archived_at).length > 1 ? "s" : ""}</span></>
            )}
          </p>
        </div>
        <InviteDialog poles={poles} onDone={invalidate} />
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-64">
          <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
          <Input className="pl-9" placeholder="Rechercher (nom, email)…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as any)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Rôle" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les rôles</SelectItem>
            {STAFF_ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Statut" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Actifs</SelectItem>
            <SelectItem value="disabled">Désactivés</SelectItem>
            <SelectItem value="all">Tous</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <Card className="p-8 text-center border-destructive/30 bg-destructive/5 space-y-3">
          <AlertTriangle className="h-6 w-6 mx-auto text-destructive" />
          <div className="font-medium text-sm">Impossible de charger l'équipe.</div>
          <div className="text-xs text-muted-foreground">{(error as any)?.message ?? "Erreur inconnue"}</div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Réessayer</Button>
        </Card>
      ) : isLoading ? (
        <Card className="p-12 text-center text-muted-foreground text-sm">Chargement de l'équipe…</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <Users className="h-8 w-8 mx-auto text-muted-foreground" />
          <div className="font-display text-lg">Aucun membre à afficher</div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {members.length === 0
              ? "Aucun membre d'équipe pour le moment. Invitez votre premier collaborateur pour commencer."
              : "Aucun membre ne correspond aux filtres actuels."}
          </p>
        </Card>
      ) : (
        <Card className="divide-y">
          {filtered.map((m) => (
            <MemberRow key={m.id} member={m} isAdmin={isAdmin} onDone={invalidate} />
          ))}
        </Card>
      )}
    </div>
  );
}

function MemberRow({ member, isAdmin, onDone }: { member: TeamMember; isAdmin: boolean; onDone: () => void }) {
  const pr = primaryRole(member.roles);
  const online = member.active_sessions > 0;
  const disabled = !!member.archived_at;

  return (
    <div className="p-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-64">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <div className="font-medium truncate">
            {member.prenom || member.nom ? `${member.prenom ?? ""} ${member.nom ?? ""}`.trim() : member.email}
          </div>
          {pr && (
            <Badge variant="outline" className="text-xs">{roleLabelFr(pr)}</Badge>
          )}
          {disabled && (
            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-xs">Désactivé</Badge>
          )}
          {!disabled && online && (
            <Badge variant="outline" className="bg-success/15 text-success border-success/30 text-xs gap-1">
              <Circle className="h-2 w-2 fill-current" /> En ligne
            </Badge>
          )}
          {!disabled && member.browser_notifications_active && (
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-xs gap-1">
              <BellRing className="h-3 w-3" /> Push actif
            </Badge>
          )}
          {!disabled && !member.browser_notifications_active && (
            <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-xs gap-1">
              <BellOff className="h-3 w-3" /> Push inactif
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">{member.email}</div>
        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
          <span>Dernière activité : {relativeDate(member.last_activity)}</span>
          {member.poles.length > 0 && (
            <span>Pôles : {member.poles.map((p) => p.nom).join(", ")}</span>
          )}
          {member.poles.length === 0 && (pr === "manager" || pr === "consultant") && (
            <span className="text-warning-foreground">Aucun pôle assigné</span>
          )}
          {member.push_subscriptions_count > 0 && (
            <span>{member.push_subscriptions_count} appareil{member.push_subscriptions_count > 1 ? "s" : ""} notifications PC</span>
          )}
        </div>
      </div>
      <MemberActions member={member} isAdmin={isAdmin} onDone={onDone} />
    </div>
  );
}

function MemberActions({ member, isAdmin, onDone }: { member: TeamMember; isAdmin: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const disabled = !!member.archived_at;

  const resetFn = useServerFn(resetTeamMemberPassword);
  const disableFn = useServerFn(disableTeamMember);
  const enableFn = useServerFn(enableTeamMember);

  const resetMut = useMutation({
    mutationFn: () => resetFn({ data: { userId: member.id } }),
    onSuccess: () => toast.success("Email de réinitialisation envoyé"),
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });
  const disableMut = useMutation({
    mutationFn: (reason?: string) => disableFn({ data: { userId: member.id, reason } }),
    onSuccess: () => { toast.success("Membre désactivé"); onDone(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });
  const enableMut = useMutation({
    mutationFn: () => enableFn({ data: { userId: member.id } }),
    onSuccess: () => { toast.success("Membre réactivé"); onDone(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            <MoreVertical className="h-4 w-4" /> Actions
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-1">
          {isAdmin && !disabled && (
            <button
              onClick={() => { setOpen(false); setEditOpen(true); }}
              className="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted flex items-center gap-2"
            >
              <ShieldCheck className="h-4 w-4" /> Modifier le rôle
            </button>
          )}
          {!disabled && (
            <button
              onClick={() => { setOpen(false); resetMut.mutate(); }}
              disabled={resetMut.isPending}
              className="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted flex items-center gap-2"
            >
              <KeyRound className="h-4 w-4" /> Réinitialiser le mot de passe
            </button>
          )}
          {isAdmin && !disabled && (
            <DisableAction member={member} onConfirm={(reason) => { setOpen(false); disableMut.mutate(reason); }} />
          )}
          {isAdmin && disabled && (
            <button
              onClick={() => { setOpen(false); enableMut.mutate(); }}
              disabled={enableMut.isPending}
              className="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted flex items-center gap-2 text-success"
            >
              <Power className="h-4 w-4" /> Réactiver
            </button>
          )}
        </PopoverContent>
      </Popover>
      <EditRoleDialog open={editOpen} onOpenChange={setEditOpen} member={member} onDone={onDone} />
    </>
  );
}

function DisableAction({ member, onConfirm }: { member: TeamMember; onConfirm: (reason?: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted flex items-center gap-2 text-destructive">
          <PowerOff className="h-4 w-4" /> Désactiver
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Désactiver ce membre ?</AlertDialogTitle>
          <AlertDialogDescription>
            {member.email} ne pourra plus accéder à la plateforme. Ses sessions actives seront fermées immédiatement. L'action est journalisée.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="disable-reason">Motif (optionnel)</Label>
          <Textarea id="disable-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => onConfirm(reason.trim() || undefined)}
          >
            Désactiver
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EditRoleDialog({ open, onOpenChange, member, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; member: TeamMember; onDone: () => void }) {
  const [role, setRole] = useState<StaffRole>(primaryRole(member.roles) ?? "consultant");
  const updateFn = useServerFn(updateTeamRole);
  const mut = useMutation({
    mutationFn: () => updateFn({ data: { userId: member.id, role } }),
    onSuccess: () => { toast.success("Rôle modifié"); onDone(); onOpenChange(false); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier le rôle</DialogTitle>
          <DialogDescription>Rôle principal de {member.email}. Les autres rôles staff seront remplacés.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Rôle</Label>
          <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STAFF_ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({ poles, onDone }: { poles: { id: string; nom: string; code: string }[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [role, setRole] = useState<StaffRole>("consultant");
  const [poleIds, setPoleIds] = useState<string[]>([]);
  const inviteFn = useServerFn(inviteTeamMember);
  const mut = useMutation({
    mutationFn: () => inviteFn({ data: { email, prenom: prenom || undefined, nom: nom || undefined, role, pole_ids: poleIds } }),
    onSuccess: (r: any) => {
      toast.success(r?.invited ? "Invitation envoyée" : "Rôle attribué (compte existant)");
      setOpen(false); setEmail(""); setPrenom(""); setNom(""); setRole("consultant"); setPoleIds([]);
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  const needsPole = role === "manager" || role === "consultant";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><UserPlus className="h-4 w-4" /> Inviter un membre</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inviter un membre de l'équipe</DialogTitle>
          <DialogDescription>
            Un email d'invitation sera envoyé si le compte n'existe pas. Sinon, le rôle sera simplement attribué.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="prenom">Prénom</Label>
              <Input id="prenom" value={prenom} onChange={(e) => setPrenom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nom">Nom</Label>
              <Input id="nom" value={nom} onChange={(e) => setNom(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="email">Email *</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label>Rôle *</Label>
            <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STAFF_ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {needsPole && (
            <div className="space-y-1">
              <Label>Pôles</Label>
              <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
                {poles.length === 0 && <div className="text-xs text-muted-foreground">Aucun pôle actif</div>}
                {poles.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={poleIds.includes(p.id)}
                      onChange={(e) => setPoleIds((s) => e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id))}
                    />
                    {p.nom}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !email.trim()}>
            {mut.isPending ? "Envoi…" : "Inviter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Users, FolderOpen, Save, X, Power } from "lucide-react";
import { POLE_MEMBER_ROLES, roleLabelFr } from "@/lib/role-labels";
import { OpenInternalConversationButton } from "@/components/open-internal-conversation-button";


export const Route = createFileRoute("/_authenticated/admin/poles")({
  head: () => ({ meta: [{ title: "Pôles — Direction" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const ok = roles?.some((r) => r.role === "admin" || r.role === "direction");
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: AdminPoles,
});

// Génère un slug à partir d'un libellé lisible.
function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function AdminPoles() {
  const qc = useQueryClient();

  const { data: poles = [], isLoading } = useQuery({
    queryKey: ["admin-poles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("poles").select("*").order("nom");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: memberships = [] } = useQuery({
    queryKey: ["admin-pole-members"],
    queryFn: async () => {
      const { data } = await supabase.from("pole_members").select("id, pole_id, user_id, role");
      return data ?? [];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["admin-pole-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, prenom, nom, email");
      return data ?? [];
    },
  });

  const { data: dossierCounts = {} } = useQuery({
    queryKey: ["admin-pole-dossier-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("dossiers").select("pole_id, statut");
      const m: Record<string, { total: number; actifs: number }> = {};
      for (const d of (data ?? []) as any[]) {
        if (!d.pole_id) continue;
        const s = m[d.pole_id] ?? { total: 0, actifs: 0 };
        s.total += 1;
        if (!["termine", "annule"].includes(d.statut)) s.actifs += 1;
        m[d.pole_id] = s;
      }
      return m;
    },
  });

  const membersByPole = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const mem of memberships as any[]) {
      m[mem.pole_id] = m[mem.pole_id] ?? [];
      m[mem.pole_id].push(mem);
    }
    return m;
  }, [memberships]);

  const profileById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const p of profiles as any[]) m[p.id] = p;
    return m;
  }, [profiles]);

  // Création
  const [creating, setCreating] = useState(false);
  const [newNom, setNewNom] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newCouleur, setNewCouleur] = useState("#c9a96e");
  const create = useMutation({
    mutationFn: async () => {
      const nom = newNom.trim();
      if (!nom) throw new Error("Le nom du pôle est obligatoire");
      const base = slugify(nom);
      if (!base) throw new Error("Nom de pôle invalide");
      // Assure l'unicité du code
      let code = base;
      let n = 2;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data } = await supabase.from("poles").select("id").eq("code", code).maybeSingle();
        if (!data) break;
        code = `${base}-${n++}`;
      }
      const { error } = await supabase.from("poles").insert({
        nom,
        code,
        description: newDesc.trim() || null,
        couleur: newCouleur,
        actif: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pôle créé");
      setCreating(false);
      setNewNom("");
      setNewDesc("");
      setNewCouleur("#c9a96e");
      qc.invalidateQueries({ queryKey: ["admin-poles"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Pôles</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Créez, renommez et affectez vos collaborateurs à chaque pôle métier.
          </p>
        </div>
        {!creating && (
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Nouveau pôle
          </Button>
        )}
      </div>

      {creating && (
        <Card className="p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label htmlFor="new-nom">Nom du pôle</Label>
              <Input
                id="new-nom"
                placeholder="Ex : Demande Qualiopi"
                value={newNom}
                onChange={(e) => setNewNom(e.target.value)}
                autoFocus
              />
              {newNom && (
                <p className="text-xs text-muted-foreground mt-1">
                  Identifiant technique généré : <code>{slugify(newNom) || "…"}</code>
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="new-couleur">Couleur</Label>
              <Input
                id="new-couleur"
                type="color"
                value={newCouleur}
                onChange={(e) => setNewCouleur(e.target.value)}
                className="h-9 w-full"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="new-desc">Description (facultatif)</Label>
            <Textarea
              id="new-desc"
              placeholder="À quoi sert ce pôle ?"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={2}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>Annuler</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !newNom.trim()} className="gap-2">
              <Save className="h-4 w-4" /> Créer le pôle
            </Button>
          </div>
        </Card>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}

      {!isLoading && poles.length === 0 && (
        <Card className="p-8 text-center text-muted-foreground text-sm">
          Aucun pôle pour le moment.
        </Card>
      )}

      <div className="grid gap-4">
        {poles.map((pole: any) => (
          <PoleCard
            key={pole.id}
            pole={pole}
            allPoles={poles as any[]}
            members={membersByPole[pole.id] ?? []}
            profileById={profileById}
            profiles={profiles as any[]}
            counts={(dossierCounts as any)[pole.id] ?? { total: 0, actifs: 0 }}
          />
        ))}
      </div>
    </div>
  );
}

function PoleCard({
  pole, members, profileById, profiles, counts,
}: {
  pole: any;
  members: any[];
  profileById: Record<string, any>;
  profiles: any[];
  counts: { total: number; actifs: number };
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [nom, setNom] = useState(pole.nom);
  const [description, setDescription] = useState(pole.description ?? "");
  const [couleur, setCouleur] = useState(pole.couleur ?? "#c9a96e");

  const update = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("poles")
        .update({ nom: nom.trim(), description: description.trim() || null, couleur })
        .eq("id", pole.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pôle mis à jour");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["admin-poles"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const toggleActif = useMutation({
    mutationFn: async (actif: boolean) => {
      const { error } = await supabase.from("poles").update({ actif }).eq("id", pole.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-poles"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const [transferTargetId, setTransferTargetId] = useState<string>("");
  const remove = useMutation({
    mutationFn: async () => {
      if (counts.total > 0) {
        if (!transferTargetId) throw new Error("Choisissez un pôle de destination pour transférer les dossiers");
        const { error: te } = await supabase
          .from("dossiers")
          .update({ pole_id: transferTargetId })
          .eq("pole_id", pole.id);
        if (te) throw te;
      }
      const { error } = await supabase.from("poles").delete().eq("id", pole.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(counts.total > 0 ? "Dossiers transférés puis pôle supprimé" : "Pôle supprimé");
      setTransferTargetId("");
      qc.invalidateQueries({ queryKey: ["admin-poles"] });
      qc.invalidateQueries({ queryKey: ["admin-pole-dossier-counts"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Suppression impossible"),
  });

  // Ajout membre
  const [addUserId, setAddUserId] = useState<string>("");
  const [addRole, setAddRole] = useState<"manager" | "consultant">("consultant");
  const memberUserIds = new Set(members.map((m) => m.user_id));
  const candidates = profiles.filter((p) => !memberUserIds.has(p.id));

  const addMember = useMutation({
    mutationFn: async () => {
      if (!addUserId) throw new Error("Choisissez une personne");
      // S'assure qu'elle a le rôle système correspondant
      const { data: existing } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", addUserId);
      const roles = (existing ?? []).map((r: any) => r.role);
      if (!roles.includes(addRole)) {
        const { error: rerr } = await supabase.from("user_roles").insert({ user_id: addUserId, role: addRole });
        if (rerr) throw rerr;
      }
      const { error } = await supabase.from("pole_members").insert({
        pole_id: pole.id,
        user_id: addUserId,
        role: addRole,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Membre ajouté");
      setAddUserId("");
      qc.invalidateQueries({ queryKey: ["admin-pole-members"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.from("pole_members").delete().eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Membre retiré du pôle");
      qc.invalidateQueries({ queryKey: ["admin-pole-members"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const changeMemberRole = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: "manager" | "consultant" }) => {
      const { error } = await supabase.from("pole_members").update({ role }).eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rôle mis à jour");
      qc.invalidateQueries({ queryKey: ["admin-pole-members"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  return (
    <Card className={`p-4 space-y-4 ${!pole.actif ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="h-10 w-10 rounded-lg shrink-0 border"
            style={{ backgroundColor: pole.couleur ?? "#c9a96e" }}
            aria-hidden
          />
          <div className="min-w-0">
            {!editing ? (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-display text-xl truncate">{pole.nom}</h2>
                  {!pole.actif && <Badge variant="outline" className="text-xs">Désactivé</Badge>}
                </div>
                {pole.description && (
                  <p className="text-sm text-muted-foreground mt-1">{pole.description}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  <FolderOpen className="h-3 w-3 inline mr-1" />
                  {counts.actifs} dossier{counts.actifs > 1 ? "s" : ""} actif{counts.actifs > 1 ? "s" : ""} · {counts.total} au total
                  <span className="mx-2">·</span>
                  <Users className="h-3 w-3 inline mr-1" />
                  {members.length} membre{members.length > 1 ? "s" : ""}
                </p>
              </>
            ) : (
              <div className="space-y-2">
                <Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom du pôle" />
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Description" />
                <Input type="color" value={couleur} onChange={(e) => setCouleur(e.target.value)} className="h-9 w-24" />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setNom(pole.nom); setDescription(pole.description ?? ""); setCouleur(pole.couleur ?? "#c9a96e"); }}>
                <X className="h-4 w-4 mr-1" /> Annuler
              </Button>
              <Button size="sm" onClick={() => update.mutate()} disabled={update.isPending || !nom.trim()}>
                <Save className="h-4 w-4 mr-1" /> Enregistrer
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Label htmlFor={`actif-${pole.id}`} className="text-xs text-muted-foreground">
                  {pole.actif ? "Actif" : "Désactivé"}
                </Label>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      role="switch"
                      aria-checked={pole.actif}
                      className="inline-block"
                      aria-label={pole.actif ? "Désactiver ce pôle" : "Réactiver ce pôle"}
                    >
                      <Switch id={`actif-${pole.id}`} checked={pole.actif} onCheckedChange={() => {}} />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {pole.actif ? "Désactiver ce pôle ?" : "Réactiver ce pôle ?"}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {pole.actif
                          ? "Les dossiers existants restent accessibles, mais plus aucun nouveau dossier ne pourra être créé sur ce pôle."
                          : "Le pôle sera de nouveau disponible pour la création de dossiers."}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction onClick={() => toggleActif.mutate(!pole.actif)}>
                        Confirmer
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              {pole.actif && (
                <OpenInternalConversationButton
                  contextType="pole"
                  entityId={pole.id}
                  size="sm"
                  variant="outline"
                  label="Canal"
                />
              )}
              <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="gap-1">
                <Pencil className="h-4 w-4" /> Modifier
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-destructive gap-1">
                    <Trash2 className="h-4 w-4" /> Supprimer
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Supprimer le pôle « {pole.nom} » ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Cette action est définitive. Si des dossiers y sont encore rattachés, la suppression échouera —
                      pensez plutôt à désactiver le pôle.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction onClick={() => remove.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Supprimer
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </div>

      <div className="border-t pt-3 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4" /> Membres
        </h3>

        {members.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucun collaborateur dans ce pôle pour l'instant.</p>
        )}

        <div className="space-y-2">
          {members.map((m) => {
            const p = profileById[m.user_id];
            const displayName = p ? `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email : "Utilisateur";
            return (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{displayName}</div>
                  <div className="text-xs text-muted-foreground truncate">{p?.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={m.role}
                    onValueChange={(v) => changeMemberRole.mutate({ memberId: m.id, role: v as "manager" | "consultant" })}
                  >
                    <SelectTrigger className="h-8 w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {POLE_MEMBER_ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive gap-1">
                        <Trash2 className="h-4 w-4" /> Retirer
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Retirer ce collaborateur du pôle ?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {displayName} n'aura plus accès aux dossiers de « {pole.nom} ». Son compte reste actif.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction onClick={() => removeMember.mutate(m.id)}>Retirer</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs">Ajouter un collaborateur</Label>
            <Select value={addUserId} onValueChange={setAddUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Choisir une personne…" />
              </SelectTrigger>
              <SelectContent>
                {candidates.length === 0 && (
                  <div className="p-2 text-xs text-muted-foreground">Toutes les personnes sont déjà membres.</div>
                )}
                {candidates.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {(p.prenom || p.nom) ? `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() : p.email}
                    <span className="text-muted-foreground"> — {p.email}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <Label className="text-xs">Rôle dans le pôle</Label>
            <Select value={addRole} onValueChange={(v) => setAddRole(v as "manager" | "consultant")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POLE_MEMBER_ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => addMember.mutate()} disabled={!addUserId || addMember.isPending}>
            <Plus className="h-4 w-4 mr-1" /> Ajouter
          </Button>
        </div>
      </div>
    </Card>
  );
}

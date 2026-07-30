import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserCheck, UserPlus, X, ShieldCheck } from "lucide-react";
import {
  listDossierIntervenants,
  listExternalUsers,
  assignIntervenant,
  revokeIntervenant,
} from "@/lib/dossier-assignments.functions";

export function DossierExternalIntervenants({ dossierId }: { dossierId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listDossierIntervenants);
  const revokeFn = useServerFn(revokeIntervenant);
  const [addOpen, setAddOpen] = useState(false);

  const { data: intervenants = [], isLoading } = useQuery({
    queryKey: ["dossier-intervenants", dossierId],
    queryFn: () => listFn({ data: { dossierId } }),
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["dossier-intervenants", dossierId] });
    // Rouvre/re-seed la conversation d'audit pour intégrer le nouvel intervenant
    qc.invalidateQueries({ queryKey: ["ext-conv", dossierId] });
    qc.invalidateQueries({ queryKey: ["ext-conv-members"] });
    qc.invalidateQueries({ queryKey: ["qualiopi-requests", dossierId] });
  };

  const revokeMut = useMutation({
    mutationFn: (assignmentId: string) => revokeFn({ data: { assignmentId } }),
    onSuccess: () => {
      toast.success("Affectation révoquée");
      refreshAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });


  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="font-medium text-sm">Intervenants externes (Qualiopi)</h3>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1">
              <UserPlus className="h-3.5 w-3.5" /> Affecter
            </Button>
          </DialogTrigger>
          <AddIntervenantDialog
            dossierId={dossierId}
            onDone={() => {
              setAddOpen(false);
              refreshAll();
            }}
          />
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Chargement…</div>
      ) : intervenants.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          Aucun auditeur ni certificateur affecté à ce dossier.
        </div>
      ) : (
        <ul className="space-y-2">
          {intervenants.map((i) => {
            const name = i.prenom || i.nom ? `${i.prenom ?? ""} ${i.nom ?? ""}`.trim() : i.email;
            return (
              <li key={i.assignment_id} className="flex items-center justify-between gap-2 border rounded-md p-2">
                <div className="flex items-center gap-2 min-w-0">
                  <UserCheck className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{name}</div>
                    <div className="text-xs text-muted-foreground truncate">{i.email}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">{i.role}</Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    onClick={() => {
                      if (confirm("Révoquer cette affectation ?")) revokeMut.mutate(i.assignment_id);
                    }}
                    disabled={revokeMut.isPending}
                    aria-label="Révoquer"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function AddIntervenantDialog({ dossierId, onDone }: { dossierId: string; onDone: () => void }) {
  const [role, setRole] = useState<"auditeur" | "certificateur">("auditeur");
  const [userId, setUserId] = useState<string>("");
  const listUsersFn = useServerFn(listExternalUsers);
  const assignFn = useServerFn(assignIntervenant);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["external-users", role],
    queryFn: () => listUsersFn({ data: { role } }),
  });

  const mut = useMutation({
    mutationFn: () => assignFn({ data: { dossierId, userId, role } }),
    onSuccess: () => {
      toast.success("Intervenant affecté");
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Affecter un intervenant externe</DialogTitle>
        <DialogDescription>
          Seuls les utilisateurs ayant le rôle Auditeur ou Certificateur peuvent être affectés.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label>Rôle</Label>
          <Select value={role} onValueChange={(v) => { setRole(v as any); setUserId(""); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auditeur">Auditeur</SelectItem>
              <SelectItem value="certificateur">Certificateur</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Utilisateur</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger>
              <SelectValue placeholder={isLoading ? "Chargement…" : "Choisir un utilisateur"} />
            </SelectTrigger>
            <SelectContent>
              {users.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground">
                  Aucun utilisateur avec le rôle {role}. Invitez-le depuis /admin/equipe.
                </div>
              )}
              {users.map((u) => {
                const name = u.prenom || u.nom ? `${u.prenom ?? ""} ${u.nom ?? ""}`.trim() : u.email;
                return (
                  <SelectItem key={u.id} value={u.id}>
                    {name} — {u.email}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Annuler</Button>
        <Button onClick={() => mut.mutate()} disabled={!userId || mut.isPending}>
          {mut.isPending ? "Affectation…" : "Affecter"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

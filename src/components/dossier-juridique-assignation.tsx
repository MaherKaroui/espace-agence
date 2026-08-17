import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Scale, UserPlus, X, History } from "lucide-react";
import {
  listJuridiqueAssignments,
  listExternalUsers,
  assignIntervenant,
  revokeIntervenant,
} from "@/lib/dossier-assignments.functions";

export function DossierJuridiqueAssignation({ dossierId, canEdit }: { dossierId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listJuridiqueAssignments);
  const revokeFn = useServerFn(revokeIntervenant);
  const [open, setOpen] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["dossier-juridique", dossierId],
    queryFn: () => listFn({ data: { dossierId } }),
  });

  const actifs = rows.filter((r) => r.active !== false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dossier-juridique", dossierId] });
    qc.invalidateQueries({ queryKey: ["dossiers-mine"] });
    qc.invalidateQueries({ queryKey: ["dossier-linked-task", dossierId] });
    qc.invalidateQueries({ queryKey: ["dossier-linked-task-assignee"] });
  };

  const revokeMut = useMutation({
    mutationFn: (assignmentId: string) => revokeFn({ data: { assignmentId } }),
    onSuccess: () => { toast.success("Accès retiré"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  const nameOf = (r: (typeof rows)[number]) =>
    `${r.prenom ?? ""} ${r.nom ?? ""}`.trim() || r.email || r.user_id;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          <h3 className="font-medium text-sm">Personne juridique assignée</h3>
        </div>
        {canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1">
                <UserPlus className="h-3.5 w-3.5" /> Assigner au pôle juridique
              </Button>
            </DialogTrigger>
            <AssignDialog
              dossierId={dossierId}
              current={actifs.map((a) => a.user_id)}
              onDone={() => { setOpen(false); invalidate(); }}
            />
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Chargement…</div>
      ) : actifs.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          <Badge variant="outline">Non assigné</Badge>
          <span className="ml-2 text-xs">Seuls les administrateurs et la direction voient ce dossier.</span>
        </div>
      ) : (
        <ul className="space-y-2">
          {actifs.map((a) => (
            <li key={a.assignment_id} className="flex items-center justify-between gap-2 border rounded-md p-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">Assigné à : {nameOf(a)}</div>
                <div className="text-xs text-muted-foreground truncate">{a.email}</div>
              </div>
              {canEdit && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  aria-label="Retirer l'accès"
                  disabled={revokeMut.isPending}
                  onClick={() => { if (confirm("Retirer l'accès de cette personne ?")) revokeMut.mutate(a.assignment_id); }}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <div className="pt-2 border-t space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <History className="h-3.5 w-3.5" /> Historique des assignations
          </div>
          <ul className="space-y-0.5">
            {rows.map((r) => (
              <li key={`h-${r.assignment_id}`} className="text-xs text-muted-foreground">
                {r.assigned_by_name ?? "Un administrateur"} a assigné le dossier à {nameOf(r)} le{" "}
                {format(new Date(r.assigned_at), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}
                {r.active === false && r.revoked_at
                  ? ` — accès retiré le ${format(new Date(r.revoked_at), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function AssignDialog({ dossierId, current, onDone }: { dossierId: string; current: string[]; onDone: () => void }) {
  const listUsersFn = useServerFn(listExternalUsers);
  const assignFn = useServerFn(assignIntervenant);
  const [selected, setSelected] = useState<string[]>(current);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["juridique-users"],
    queryFn: () => listUsersFn({ data: { role: "juridique" as const } }),
  });

  const mut = useMutation({
    mutationFn: async () => {
      const toAdd = selected.filter((id) => !current.includes(id));
      for (const userId of toAdd) {
        await assignFn({ data: { dossierId, userId, role: "juridique" as const } });
      }
      return toAdd.length;
    },
    onSuccess: (n) => { toast.success(n > 0 ? "Dossier assigné" : "Aucun changement"); onDone(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Assigner au pôle juridique</DialogTitle>
        <DialogDescription>
          Seules les personnes sélectionnées (et les administrateurs) verront ce dossier, ses documents et ses échanges.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {isLoading && <div className="text-xs text-muted-foreground">Chargement…</div>}
        {!isLoading && users.length === 0 && (
          <div className="text-xs text-muted-foreground">
            Aucun membre dans le pôle Juridique. Ajoutez-les depuis Admin › Pôles.
          </div>
        )}
        {users.map((u) => {
          const name = `${u.prenom ?? ""} ${u.nom ?? ""}`.trim() || u.email;
          const already = current.includes(u.id);
          return (
            <label key={u.id} className="flex items-center gap-2 border rounded-md p-2 cursor-pointer">
              <Checkbox checked={selected.includes(u.id)} disabled={already} onCheckedChange={() => toggle(u.id)} />
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate">{name}</span>
                <span className="block text-xs text-muted-foreground truncate">{u.email}</span>
              </span>
              {already && <Badge variant="outline" className="ml-auto text-[10px]">Déjà assigné</Badge>}
            </label>
          );
        })}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Annuler</Button>
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? "Assignation…" : "Valider"}
        </Button>
      </DialogFooter>
      <Label className="sr-only">Personnes juridiques</Label>
    </DialogContent>
  );
}

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Database } from "@/integrations/supabase/types";

type Priority = Database["public"]["Enums"]["agency_task_priority"];
type Status = Database["public"]["Enums"]["agency_task_status"];
type Task = Database["public"]["Tables"]["agency_tasks"]["Row"];

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  task?: Task | null;
  defaultPoleId?: string | null;
};

const NONE = "__none__";

export function AgencyTaskFormDialog({ open, onOpenChange, task, defaultPoleId }: Props) {
  const { user } = useAuth();
  const { isAdmin, isDirection } = useRole();
  const qc = useQueryClient();
  const isEdit = !!task;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("normale");
  const [status, setStatus] = useState<Status>("a_faire");
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState<string>(NONE);
  const [coAssignees, setCoAssignees] = useState<string[]>([]);
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [poleId, setPoleId] = useState<string>(NONE);
  const [clientId, setClientId] = useState<string>(NONE);
  const [dossierId, setDossierId] = useState<string>(NONE);
  const [internalComment, setInternalComment] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setPriority(task?.priority ?? "normale");
    setStatus(task?.status ?? "a_faire");
    setDueDate(task?.due_date ? task.due_date.slice(0, 16) : "");
    setAssignedTo(task?.assigned_to ?? NONE);
    setRemindersEnabled((task as any)?.reminders_enabled ?? true);
    setPoleId(task?.pole_id ?? defaultPoleId ?? NONE);
    setClientId(task?.client_id ?? NONE);
    setDossierId(task?.dossier_id ?? NONE);
    setInternalComment(task?.internal_comment ?? "");
    setCoAssignees([]);
    if (task?.id) {
      supabase
        .from("agency_task_assignees")
        .select("user_id")
        .eq("task_id", task.id)
        .then(({ data }) => setCoAssignees((data ?? []).map((r) => r.user_id)));
    }
  }, [open, task, defaultPoleId]);


  const { data: poles = [] } = useQuery({
    queryKey: ["agency-task-poles"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("poles").select("id, nom, code").eq("actif", true).order("nom");
      return data ?? [];
    },
  });

  const { data: staff = [] } = useQuery({
    queryKey: ["agency-task-staff"],
    enabled: open,
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id, role").in("role", ["admin","direction","manager","consultant"]);
      const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
      if (!ids.length) return [] as { id: string; label: string }[];
      const { data: profs } = await supabase.from("profiles").select("id, nom, prenom, email").in("id", ids);
      return (profs ?? []).map((p) => ({
        id: p.id,
        label: `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || p.id,
      }));
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["agency-task-clients"],
    enabled: open,
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "client");
      const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
      if (!ids.length) return [] as { id: string; label: string }[];
      const { data: profs } = await supabase.from("profiles").select("id, nom, prenom, email").in("id", ids).is("archived_at", null);
      return (profs ?? []).map((p) => ({
        id: p.id,
        label: `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || p.id,
      }));
    },
  });

  const { data: dossiers = [] } = useQuery({
    queryKey: ["agency-task-dossiers", clientId],
    enabled: open && clientId !== NONE,
    queryFn: async () => {
      const { data } = await supabase.from("dossiers").select("id, titre").eq("client_id", clientId).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Non authentifié");
      if (!title.trim()) throw new Error("Le titre est requis");
      if (!isAdmin && !isDirection && poleId === NONE) throw new Error("Un pôle est requis");

      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        status,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        assigned_to: assignedTo === NONE ? null : assignedTo,
        pole_id: poleId === NONE ? null : poleId,
        client_id: clientId === NONE ? null : clientId,
        dossier_id: dossierId === NONE ? null : dossierId,
        internal_comment: internalComment.trim() || null,
        reminders_enabled: remindersEnabled,
      };

      let taskId = task?.id ?? null;
      if (isEdit && task) {
        const { error } = await supabase.from("agency_tasks").update(payload).eq("id", task.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("agency_tasks")
          .insert({ ...payload, created_by: user.id })
          .select("id")
          .single();
        if (error) throw error;
        taskId = data.id;
      }

      // Assignés supplémentaires (multi-assignation)
      if (taskId) {
        const { data: existing } = await supabase
          .from("agency_task_assignees")
          .select("user_id")
          .eq("task_id", taskId);
        const current = new Set((existing ?? []).map((r) => r.user_id));
        const target = new Set(coAssignees.filter((id) => id !== (assignedTo === NONE ? null : assignedTo)));
        const toAdd = [...target].filter((id) => !current.has(id));
        const toRemove = [...current].filter((id) => !target.has(id));
        if (toAdd.length) {
          const { error } = await supabase
            .from("agency_task_assignees")
            .insert(toAdd.map((uid) => ({ task_id: taskId!, user_id: uid, added_by: user.id })));
          if (error) throw error;
        }
        if (toRemove.length) {
          await supabase.from("agency_task_assignees").delete().eq("task_id", taskId).in("user_id", toRemove);
        }
      }
    },

    onSuccess: () => {
      toast.success(isEdit ? "Tâche mise à jour" : "Tâche créée");
      qc.invalidateQueries({ queryKey: ["agency-tasks"] });
      qc.invalidateQueries({ queryKey: ["agency-tasks-kpis"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifier la tâche" : "Créer une tâche"}</DialogTitle>
          <DialogDescription>Tâche interne agence. Non visible par les clients.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Titre *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Ex : Relancer client dossier X" />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Priorité</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgente">Urgente</SelectItem>
                  <SelectItem value="haute">Haute</SelectItem>
                  <SelectItem value="normale">Normale</SelectItem>
                  <SelectItem value="basse">Basse</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Statut</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="a_faire">À faire</SelectItem>
                  <SelectItem value="en_cours">En cours</SelectItem>
                  <SelectItem value="en_attente">En attente</SelectItem>
                  <SelectItem value="bloquee">Bloquée</SelectItem>
                  <SelectItem value="terminee">Terminée</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Date limite</Label>
              <Input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Assigné à</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger><SelectValue placeholder="Personne" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— Non assigné —</SelectItem>
                  {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Autres personnes assignées</Label>
            <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
              {staff.filter((s) => s.id !== assignedTo).map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={coAssignees.includes(s.id)}
                    onChange={(e) =>
                      setCoAssignees((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id)))
                    }
                  />
                  {s.label}
                </label>
              ))}
              {staff.length === 0 && <div className="text-xs text-muted-foreground">Aucun membre disponible.</div>}
            </div>
            <p className="text-xs text-muted-foreground">
              Chaque personne assignée reçoit les notifications et les rappels de la tâche.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={remindersEnabled}
              onChange={(e) => setRemindersEnabled(e.target.checked)}
            />
            Rappels automatiques (J-2, J-1, jour J puis en cas de retard)
          </label>



          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Pôle</Label>
              <Select value={poleId} onValueChange={setPoleId}>
                <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— Aucun —</SelectItem>
                  {poles.map((p) => <SelectItem key={p.id} value={p.id}>{p.nom}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Client (optionnel)</Label>
              <Select value={clientId} onValueChange={(v) => { setClientId(v); setDossierId(NONE); }}>
                <SelectTrigger><SelectValue placeholder="Aucun" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— Aucun —</SelectItem>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {clientId !== NONE && dossiers.length > 0 && (
            <div className="space-y-2">
              <Label>Dossier (optionnel)</Label>
              <Select value={dossierId} onValueChange={setDossierId}>
                <SelectTrigger><SelectValue placeholder="Aucun" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— Aucun —</SelectItem>
                  {dossiers.map((d) => <SelectItem key={d.id} value={d.id}>{d.titre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Commentaire interne</Label>
            <Textarea value={internalComment} onChange={(e) => setInternalComment(e.target.value)} rows={2} maxLength={1000} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Enregistrement…" : isEdit ? "Enregistrer" : "Créer la tâche"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

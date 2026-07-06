import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Archive, Pencil, Send } from "lucide-react";
import { PriorityBadge, StatusBadge } from "./agency-task-badges";
import { AgencyTaskFormDialog } from "./agency-task-form-dialog";


import type { Database } from "@/integrations/supabase/types";

type Task = Database["public"]["Tables"]["agency_tasks"]["Row"];
type Status = Database["public"]["Enums"]["agency_task_status"];

export function AgencyTaskDetailDialog({
  taskId, open, onOpenChange,
}: { taskId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const { isAdmin, isDirection } = useRole();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [comment, setComment] = useState("");

  const { data: task } = useQuery({
    queryKey: ["agency-task", taskId],
    enabled: !!taskId && open,
    queryFn: async () => {
      const { data, error } = await supabase.from("agency_tasks").select("*").eq("id", taskId!).maybeSingle();
      if (error) throw error;
      return data as Task | null;
    },
  });

  const { data: profilesMap = {} } = useQuery({
    queryKey: ["agency-task-profiles", task?.created_by, task?.assigned_to, task?.client_id],
    enabled: !!task,
    queryFn: async () => {
      const ids = [task?.created_by, task?.assigned_to, task?.client_id].filter(Boolean) as string[];
      if (!ids.length) return {};
      const { data } = await supabase.from("profiles").select("id, nom, prenom, email").in("id", ids);
      return Object.fromEntries((data ?? []).map((p) => [p.id, `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || p.id]));
    },
  });

  const { data: comments = [] } = useQuery({
    queryKey: ["agency-task-comments", taskId],
    enabled: !!taskId && open,
    queryFn: async () => {
      const { data, error } = await supabase.from("agency_task_comments").select("*").eq("task_id", taskId!).order("created_at");
      if (error) throw error;
      const ids = Array.from(new Set((data ?? []).map((c) => c.user_id)));
      const profs = ids.length ? (await supabase.from("profiles").select("id, nom, prenom, email").in("id", ids)).data ?? [] : [];
      const m = new Map(profs.map((p) => [p.id, `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || p.id]));
      return (data ?? []).map((c) => ({ ...c, author: m.get(c.user_id) ?? c.user_id }));
    },
  });

  const changeStatus = useMutation({
    mutationFn: async (status: Status) => {
      const { error } = await supabase.from("agency_tasks").update({ status }).eq("id", taskId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Statut mis à jour");
      qc.invalidateQueries({ queryKey: ["agency-task", taskId] });
      qc.invalidateQueries({ queryKey: ["agency-tasks"] });
      qc.invalidateQueries({ queryKey: ["agency-tasks-kpis"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const archive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("agency_tasks").update({ archived_at: new Date().toISOString() }).eq("id", taskId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tâche archivée");
      qc.invalidateQueries({ queryKey: ["agency-tasks"] });
      qc.invalidateQueries({ queryKey: ["agency-tasks-kpis"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const addComment = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Non authentifié");
      const trimmed = comment.trim();
      if (!trimmed) throw new Error("Commentaire vide");
      const { error } = await supabase.from("agency_task_comments").insert({ task_id: taskId!, user_id: user.id, content: trimmed });
      if (error) throw error;
    },
    onSuccess: () => {
      setComment("");
      qc.invalidateQueries({ queryKey: ["agency-task-comments", taskId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  if (!task) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent><DialogHeader><DialogTitle>Chargement…</DialogTitle></DialogHeader></DialogContent>
      </Dialog>
    );
  }

  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  const canArchive = isAdmin || isDirection;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-start justify-between gap-3 pr-6">
              <span className="flex-1">{task.title}</span>
              <div className="flex gap-1 flex-shrink-0">
                <PriorityBadge value={task.priority} />
                <StatusBadge value={task.status} />
              </div>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {task.description && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>}

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Échéance :</span> {fmtDate(task.due_date)}</div>
              <div><span className="text-muted-foreground">Assigné à :</span> {task.assigned_to ? profilesMap[task.assigned_to] ?? "…" : "—"}</div>
              <div><span className="text-muted-foreground">Créé par :</span> {task.created_by ? profilesMap[task.created_by] ?? "…" : "—"}</div>
              <div><span className="text-muted-foreground">Créé le :</span> {fmtDate(task.created_at)}</div>
              {task.client_id && <div><span className="text-muted-foreground">Client :</span> {profilesMap[task.client_id] ?? "…"}</div>}
              {task.completed_at && <div><span className="text-muted-foreground">Terminé le :</span> {fmtDate(task.completed_at)}</div>}
            </div>

            {task.internal_comment && (
              <Card className="p-3 bg-muted/50 text-sm whitespace-pre-wrap">{task.internal_comment}</Card>
            )}

            <div className="flex flex-wrap gap-2">
              <Select value={task.status} onValueChange={(v) => changeStatus.mutate(v as Status)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="a_faire">À faire</SelectItem>
                  <SelectItem value="en_cours">En cours</SelectItem>
                  <SelectItem value="bloquee">Bloquée</SelectItem>
                  <SelectItem value="terminee">Terminée</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4 mr-1" /> Modifier
              </Button>
              {canArchive && !task.archived_at && (
                <Button variant="outline" size="sm" onClick={() => archive.mutate()} disabled={archive.isPending}>
                  <Archive className="h-4 w-4 mr-1" /> Archiver
                </Button>
              )}
              <OpenInternalConversationButton
                contextType="task"
                entityId={task.id}
                size="sm"
                variant="outline"
                label="Discussion interne"
              />
            </div>


            <div className="space-y-2 pt-2 border-t">
              <div className="text-sm font-medium">Commentaires ({comments.length})</div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {comments.length === 0 && <div className="text-xs text-muted-foreground">Aucun commentaire.</div>}
                {comments.map((c) => (
                  <div key={c.id} className="text-sm border-l-2 border-primary/40 pl-3 py-1">
                    <div className="text-xs text-muted-foreground">{c.author} · {fmtDate(c.created_at)}</div>
                    <div className="whitespace-pre-wrap">{c.content}</div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Ajouter un commentaire…" maxLength={1000} />
                <Button size="sm" onClick={() => addComment.mutate()} disabled={addComment.isPending || !comment.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AgencyTaskFormDialog open={editOpen} onOpenChange={setEditOpen} task={task} />
    </>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { extractTaskFromMessage, createTaskFromDraft } from "@/lib/internal-ai.functions";

type Draft = {
  title: string;
  description: string | null;
  priority: "basse" | "normale" | "haute" | "urgente";
  due_date: string | null;
  assigned_to: string | null;
  pole_id: string | null;
  client_id: string | null;
  dossier_id: string | null;
};

export function CreateTaskFromMessageDialog({
  open,
  onOpenChange,
  messageId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  messageId: string;
}) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const extractFn = useServerFn(extractTaskFromMessage);
  const createFn = useServerFn(createTaskFromDraft);
  const [draft, setDraft] = useState<Draft | null>(null);

  const { data: staff = [] } = useQuery({
    queryKey: ["staff-select"],
    enabled: open,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "direction", "manager", "consultant"]);
      const ids = Array.from(new Set(((roles ?? []) as any[]).map((r) => r.user_id)));
      if (ids.length === 0) return [];
      const { data: profs } = await supabase.from("profiles").select("id, prenom, nom, email").in("id", ids);
      return (profs ?? []) as any[];
    },
  });

  const extract = useMutation({
    mutationFn: () => extractFn({ data: { messageId } }),
    onSuccess: (r: any) => setDraft(r),
    onError: (e: any) => toast.error(e.message ?? "Extraction impossible"),
  });

  const create = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("Brouillon vide");
      return createFn({
        data: {
          title: draft.title,
          description: draft.description,
          priority: draft.priority,
          due_date: draft.due_date,
          assigned_to: draft.assigned_to,
          pole_id: draft.pole_id,
          client_id: draft.client_id,
          dossier_id: draft.dossier_id,
          source_message_id: messageId,
        },
      });
    },
    onSuccess: (r: any) => {
      toast.success("Tâche créée");
      qc.invalidateQueries({ queryKey: ["agency-tasks"] });
      onOpenChange(false);
      setDraft(null);
      nav({ to: "/admin/taches-agence", search: { task: r.id } as any });
    },
    onError: (e: any) => toast.error(e.message ?? "Création impossible"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (v && !draft) extract.mutate();
        if (!v) setDraft(null);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Créer une tâche depuis le message
          </DialogTitle>
        </DialogHeader>
        {extract.isPending && (
          <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Analyse du message…
          </div>
        )}
        {draft && (
          <div className="space-y-3">
            <div>
              <Label>Titre</Label>
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={draft.description ?? ""}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Priorité</Label>
                <Select
                  value={draft.priority}
                  onValueChange={(v: any) => setDraft({ ...draft, priority: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basse">Basse</SelectItem>
                    <SelectItem value="normale">Normale</SelectItem>
                    <SelectItem value="haute">Haute</SelectItem>
                    <SelectItem value="urgente">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Échéance</Label>
                <Input
                  type="date"
                  value={draft.due_date ?? ""}
                  onChange={(e) => setDraft({ ...draft, due_date: e.target.value || null })}
                />
              </div>
            </div>
            <div>
              <Label>Assigner à</Label>
              <Select
                value={draft.assigned_to ?? "none"}
                onValueChange={(v) => setDraft({ ...draft, assigned_to: v === "none" ? null : v })}
              >
                <SelectTrigger><SelectValue placeholder="Non assignée" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Non assignée</SelectItem>
                  {staff.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {`${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={() => create.mutate()} disabled={!draft || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Créer la tâche
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { personName, type PcMembre } from "@/lib/pole-certification";
import { errMsg, useFicheRefresh, type FicheCtx } from "./fiche-context";

const db = supabase as any;

/** Personnes affectées : collaborateur (complète le dossier) ou lecture seule (ex. audit Qualiopi). */
export function FicheMembres({ ctx }: { ctx: FicheCtx }) {
  const refresh = useFicheRefresh(ctx.dossier.id);
  const canManage = !ctx.dossier.archived_at && (ctx.isAdmin || ctx.dossier.responsable_id === ctx.uid);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<PcMembre["role"]>("collaborateur");
  const candidates = ctx.staff.filter((p) => p.id !== ctx.dossier.responsable_id && !ctx.membres.some((m) => m.user_id === p.id));

  const add = async () => {
    if (!userId) return;
    const { error } = await db.from("pc_membres").insert({ dossier_id: ctx.dossier.id, user_id: userId, role });
    if (error) return toast.error(errMsg(error));
    setUserId("");
    toast.success("Personne affectée");
    refresh();
  };
  const remove = async (m: PcMembre) => {
    const { error } = await db.from("pc_membres").delete().eq("dossier_id", m.dossier_id).eq("user_id", m.user_id);
    if (error) return toast.error(errMsg(error));
    refresh();
  };

  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-xs uppercase tracking-wider text-gold">Personnes affectées</h3>
      <ul className="space-y-1.5 text-sm">
        <li className="flex items-center justify-between gap-2">
          <span>{personName(ctx.profiles.get(ctx.dossier.responsable_id))}</span>
          <span className="text-xs text-muted-foreground">Responsable</span>
        </li>
        {ctx.membres.map((m) => (
          <li key={m.user_id} className="flex items-center justify-between gap-2">
            <span className="truncate">{personName(ctx.profiles.get(m.user_id))}</span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {m.role === "lecture" ? "Lecture seule" : "Collaborateur"}
              {canManage && (
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(m)} aria-label="Retirer"><Trash2 className="h-3.5 w-3.5" /></Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="flex flex-col gap-2">
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger><SelectValue placeholder="Ajouter une personne" /></SelectTrigger>
            <SelectContent>{candidates.map((p) => <SelectItem key={p.id} value={p.id}>{personName(p)}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex gap-2">
            <Select value={role} onValueChange={(v) => setRole(v as PcMembre["role"])}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="collaborateur">Collaborateur</SelectItem>
                <SelectItem value="lecture">Lecture seule</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={add} disabled={!userId}><UserPlus className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
    </Card>
  );
}

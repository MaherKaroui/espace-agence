import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PC_TYPES, personName, type PcDossier, type PcType } from "@/lib/pole-certification";
import { PC_ALL_KEY, usePcStaff } from "./use-pc";

/** Création d'un dossier ; `parent` pré-remplit un dossier EDOF lié à un parcours certificateur. */
export function NewPcDossierDialog({
  open, onOpenChange, parent,
}: { open: boolean; onOpenChange: (o: boolean) => void; parent?: PcDossier }) {
  const { user } = useAuth();
  const { isDirectionOrAdmin } = useRole();
  const { data: staff = [] } = usePcStaff();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [type, setType] = useState<PcType>("certificateur");
  const [titre, setTitre] = useState("");
  const [organisme, setOrganisme] = useState("");
  const [certificateur, setCertificateur] = useState("");
  const [codeRs, setCodeRs] = useState("");
  const [dateCible, setDateCible] = useState("");
  const [responsable, setResponsable] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setType(parent ? "edof" : "certificateur");
    setTitre(parent ? `EDOF — ${parent.organisme || parent.titre}` : "");
    setOrganisme(parent?.organisme ?? "");
    setCertificateur(parent?.certificateur ?? "");
    setCodeRs(parent?.code_rs ?? "");
    setDateCible("");
    setResponsable(parent?.responsable_id ?? user?.id ?? "");
    setNotes("");
  }, [open, parent, user?.id]);

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).from("pc_dossiers").insert({
        type,
        titre: titre.trim(),
        organisme: organisme.trim() || null,
        certificateur: certificateur.trim() || null,
        code_rs: codeRs.trim() || null,
        date_cible: dateCible || null,
        responsable_id: responsable || user!.id,
        notes: notes.trim() || null,
        parent_id: parent?.id ?? null,
        created_by: user!.id,
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      toast.success("Dossier créé avec ses étapes par défaut");
      qc.invalidateQueries({ queryKey: PC_ALL_KEY });
      onOpenChange(false);
      navigate({ to: "/pole-certification/$id", params: { id } });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{parent ? "Créer le dossier EDOF lié" : "Nouveau dossier"}</DialogTitle></DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); if (titre.trim()) create.mutate(); }}
        >
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as PcType)} disabled={!!parent}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pc-titre">{type === "edof" ? "Nom de l'organisme / du référencement" : "Nom de la certification"} *</Label>
            <Input id="pc-titre" value={titre} onChange={(e) => setTitre(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pc-org">Organisme</Label>
              <Input id="pc-org" value={organisme} onChange={(e) => setOrganisme(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pc-cert">Certificateur</Label>
              <Input id="pc-cert" value={certificateur} onChange={(e) => setCertificateur(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pc-rs">Code RS / RNCP</Label>
              <Input id="pc-rs" value={codeRs} onChange={(e) => setCodeRs(e.target.value)} placeholder="RS1234" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pc-cible">Date cible</Label>
              <Input id="pc-cible" type="date" value={dateCible} onChange={(e) => setDateCible(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Responsable</Label>
            <Select value={responsable} onValueChange={setResponsable} disabled={!isDirectionOrAdmin}>
              <SelectTrigger><SelectValue placeholder="Responsable" /></SelectTrigger>
              <SelectContent>{staff.map((p) => <SelectItem key={p.id} value={p.id}>{personName(p)}</SelectItem>)}</SelectContent>
            </Select>
            {!isDirectionOrAdmin && <p className="text-xs text-muted-foreground">Vous êtes responsable des dossiers que vous créez.</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pc-notes">Notes</Label>
            <Textarea id="pc-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button type="submit" disabled={!titre.trim() || create.isPending}>{create.isPending ? "Création…" : "Créer"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

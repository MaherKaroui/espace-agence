import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORIES, categorieLabel } from "@/lib/labels";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/pieces-modeles")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Pièces attendues par catégorie — IZISuivis" },
      {
        name: "description",
        content:
          "Gérez la liste de référence des documents demandés aux organismes de formation pour chaque type de demande.",
      },
      { property: "og:title", content: "Pièces attendues par catégorie — IZISuivis" },
      {
        property: "og:description",
        content: "Liste de référence des pièces à fournir, utilisée par l'assistant IZISuivis.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Row = {
  id: string;
  categorie: string;
  libelle: string;
  motif: string | null;
  obligatoire: boolean;
  ordre: number;
  actif: boolean;
};

function Page() {
  const qc = useQueryClient();
  const [categorie, setCategorie] = useState<string>("nda");
  const [libelle, setLibelle] = useState("");
  const [motif, setMotif] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["pieces-modeles", categorie],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("demande_pieces_modeles")
        .select("id, categorie, libelle, motif, obligatoire, ordre, actif")
        .eq("categorie", categorie as any)
        .order("ordre");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["pieces-modeles", categorie] });

  const add = useMutation({
    mutationFn: async () => {
      const ordre = (rows[rows.length - 1]?.ordre ?? 0) + 1;
      const { error } = await supabase
        .from("demande_pieces_modeles")
        .insert({ categorie: categorie as any, libelle: libelle.trim(), motif: motif.trim() || null, ordre });
      if (error) throw error;
    },
    onSuccess: () => {
      setLibelle("");
      setMotif("");
      invalidate();
      toast.success("Pièce ajoutée.");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Row> }) => {
      const { error } = await supabase.from("demande_pieces_modeles").update(patch as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("demande_pieces_modeles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Pièce retirée.");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const swap = (index: number, dir: -1 | 1) => {
    const a = rows[index];
    const b = rows[index + dir];
    if (!a || !b) return;
    update.mutate({ id: a.id, patch: { ordre: b.ordre } });
    update.mutate({ id: b.id, patch: { ordre: a.ordre } });
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl">Pièces attendues par catégorie</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Liste de référence utilisée par l'assistant IA et à la création d'une demande. L'assistant ne complète
            jamais cette liste de lui-même. Les listes fournies au départ sont un point de départ à valider par
            l'agence.
          </p>
        </header>

        <Card className="p-4">
          <Label className="text-xs text-muted-foreground">Catégorie</Label>
          <Select value={categorie} onValueChange={setCategorie}>
            <SelectTrigger className="mt-1 max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Card>

        <Card className="p-4">
          <h2 className="font-display text-lg">{categorieLabel(categorie)}</h2>
          {isLoading ? (
            <p className="mt-3 text-sm text-muted-foreground">Chargement…</p>
          ) : rows.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Aucune pièce définie pour cette catégorie.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {rows.map((r, i) => (
                <li key={r.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="flex flex-col">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Monter"
                      disabled={i === 0}
                      onClick={() => swap(i, -1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Descendre"
                      disabled={i === rows.length - 1}
                      onClick={() => swap(i, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="min-w-[220px] flex-1 space-y-2">
                    <Input
                      aria-label="Libellé de la pièce"
                      defaultValue={r.libelle}
                      onBlur={(e) =>
                        e.target.value.trim() !== r.libelle &&
                        update.mutate({ id: r.id, patch: { libelle: e.target.value.trim() } })
                      }
                    />
                    <Input
                      aria-label="Motif de la demande"
                      placeholder="Motif (pourquoi cette pièce est demandée)"
                      defaultValue={r.motif ?? ""}
                      onBlur={(e) =>
                        (e.target.value.trim() || null) !== r.motif &&
                        update.mutate({ id: r.id, patch: { motif: e.target.value.trim() || null } })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2 text-xs">
                    <label className="flex items-center gap-2">
                      <Switch
                        checked={r.obligatoire}
                        onCheckedChange={(v) => update.mutate({ id: r.id, patch: { obligatoire: v } })}
                      />
                      Obligatoire
                    </label>
                    <label className="flex items-center gap-2">
                      <Switch
                        checked={r.actif}
                        onCheckedChange={(v) => update.mutate({ id: r.id, patch: { actif: v } })}
                      />
                      Actif
                    </label>
                  </div>
                  <Button variant="ghost" size="icon" aria-label="Supprimer" onClick={() => remove.mutate(r.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="min-w-[200px] flex-1">
              <Label className="text-xs text-muted-foreground">Nouvelle pièce</Label>
              <Input value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="Libellé du document" />
            </div>
            <div className="min-w-[200px] flex-1">
              <Label className="text-xs text-muted-foreground">Motif</Label>
              <Input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Pourquoi elle est demandée" />
            </div>
            <Button onClick={() => add.mutate()} disabled={!libelle.trim() || add.isPending}>
              <Plus className="mr-1 h-4 w-4" /> Ajouter
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

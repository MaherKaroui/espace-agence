import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/status-badge";
import { CATEGORIES, categorieLabel } from "@/lib/labels";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dossiers")({
  head: () => ({ meta: [{ title: "Mes dossiers" }] }),
  component: DossiersPage,
});

function DossiersPage() {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  const { data: dossiers = [], isLoading } = useQuery({
    queryKey: ["dossiers-mine", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const q = supabase.from("dossiers").select("*").order("updated_at", { ascending: false });
      const { data, error } = isAdmin ? await q : await q.eq("client_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async (payload: { titre: string; categorie: string; description: string }) => {
      const { error } = await supabase.from("dossiers").insert({
        client_id: user!.id,
        titre: payload.titre,
        categorie: payload.categorie as any,
        description: payload.description || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dossier créé");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["dossiers-mine"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const titre = (fd.get("titre") as string)?.trim();
    const categorie = fd.get("categorie") as string;
    const description = (fd.get("description") as string)?.trim() ?? "";
    if (!titre || !categorie) { toast.error("Champs requis"); return; }
    create.mutate({ titre, categorie, description });
  };

  const filtered = filter === "all" ? dossiers : dossiers.filter((d) => d.categorie === filter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Mes dossiers</h1>
          <p className="text-muted-foreground mt-1">Suivez l'avancement et déposez vos pièces.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Nouveau dossier</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nouveau dossier</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="titre">Titre</Label>
                <Input id="titre" name="titre" required maxLength={120} />
              </div>
              <div>
                <Label>Catégorie</Label>
                <Select name="categorie" required>
                  <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="description">Description (optionnel)</Label>
                <Textarea id="description" name="description" rows={3} maxLength={500} />
              </div>
              <Button type="submit" disabled={create.isPending} className="w-full">Créer le dossier</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>Tous</FilterChip>
        {CATEGORIES.map((c) => (
          <FilterChip key={c.value} active={filter === c.value} onClick={() => setFilter(c.value)}>{c.label}</FilterChip>
        ))}
      </div>

      {isLoading ? (
        <Card className="p-8 text-center text-muted-foreground">Chargement…</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">Aucun dossier dans cette catégorie.</p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((d) => (
            <Link key={d.id} to="/dossiers/$id" params={{ id: d.id }}>
              <Card className="p-5 hover:border-primary/40 transition-colors h-full">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase tracking-wider text-gold font-medium">{categorieLabel(d.categorie)}</span>
                  <StatusBadge statut={d.statut} />
                </div>
                <div className="font-medium">{d.titre}</div>
                {d.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{d.description}</p>}
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Avancement</span><span>{d.avancement}%</span>
                  </div>
                  <Progress value={d.avancement} className="h-1.5" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/40"
      }`}
    >
      {children}
    </button>
  );
}

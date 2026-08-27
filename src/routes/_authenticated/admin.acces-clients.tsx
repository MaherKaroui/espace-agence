import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  KeyRound, Search, Plus, Pencil, Trash2, Copy, Eye, EyeOff, ShieldCheck,
} from "lucide-react";
import {
  listClientAcces, saveClientAcces, deleteClientAcces, revealClientAcces,
} from "@/lib/client-acces.functions";

export const Route = createFileRoute("/_authenticated/admin/acces-clients")({
  head: () => ({
    meta: [
      { title: "Accès clients — IZISuivis" },
      { name: "description", content: "Coffre-fort des accès plateformes clients, réservé à l'équipe de l'agence." },
      { property: "og:title", content: "Accès clients — IZISuivis" },
      { property: "og:description", content: "Coffre-fort des accès plateformes clients, réservé à l'équipe de l'agence." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const ok = roles?.some((r) => ["admin", "direction", "manager", "consultant"].includes(r.role as string));
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: AccesClients,
});

type Acces = Awaited<ReturnType<typeof listClientAcces>>[number];

const EMPTY = {
  id: null as string | null,
  organisme: "",
  libelle: "",
  identifiant: "",
  secret: "",
};

function AccesClients() {
  const qc = useQueryClient();
  const list = useServerFn(listClientAcces);
  const save = useServerFn(saveClientAcces);
  const del = useServerFn(deleteClientAcces);
  const reveal = useServerFn(revealClientAcces);

  const [q, setQ] = useState("");
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Remasquage automatique au démontage (changement de page).
  useEffect(() => () => {
    Object.values(timers.current).forEach(clearTimeout);
    setRevealed({});
  }, []);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["client-acces"],
    queryFn: () => list({}),
  });

  const saveM = useMutation({
    mutationFn: (input: typeof EMPTY) =>
      save({
        data: {
          id: input.id,
          organisme: input.organisme || null,
          libelle: input.libelle,
          identifiant: input.identifiant || null,
          secret: input.secret || null,
        },
      }),
    onSuccess: () => {
      toast.success("Accès enregistré");
      setForm(null);
      qc.invalidateQueries({ queryKey: ["client-acces"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Enregistrement impossible"),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Accès supprimé");
      qc.invalidateQueries({ queryKey: ["client-acces"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Suppression impossible"),
  });

  const doReveal = async (id: string) => {
    if (revealed[id]) {
      clearTimeout(timers.current[id]!);
      setRevealed((r) => { const n = { ...r }; delete n[id]; return n; });
      return;
    }
    try {
      const { value } = await reveal({ data: { id, field: "secret", mode: "affichage" } });
      if (!value) return toast.info("Aucun mot de passe enregistré pour cet accès");
      setRevealed((r) => ({ ...r, [id]: value }));
      timers.current[id] = setTimeout(() => {
        setRevealed((r) => { const n = { ...r }; delete n[id]; return n; });
      }, 15000);
    } catch (e: any) {
      toast.error(e?.message ?? "Révélation impossible");
    }
  };

  const doCopy = async (id: string, field: "identifiant" | "secret") => {
    try {
      const { value } = await reveal({ data: { id, field, mode: "copie" } });
      if (!value) return toast.info("Rien à copier");
      await navigator.clipboard.writeText(value);
      toast.success(field === "secret" ? "Mot de passe copié" : "E-mail copié");
    } catch (e: any) {
      toast.error(e?.message ?? "Copie impossible");
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows as Acces[];
    return (rows as Acces[]).filter((r) =>
      [r.organisme, r.client_nom, r.libelle, r.identifiant]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  const groups = useMemo(() => {
    const map = new Map<string, Acces[]>();
    for (const r of filtered) {
      const key = r.organisme || r.client_nom || "Non rattaché";
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl flex items-center gap-2">
            <KeyRound className="h-6 w-6" /> Accès clients
          </h1>
          <p className="text-sm text-muted-foreground">
            Coffre-fort réservé à l'équipe. Mots de passe chiffrés, consultations journalisées.
          </p>
        </div>
        <Button onClick={() => setForm({ ...EMPTY })}>
          <Plus className="h-4 w-4 mr-1" /> Nouvel accès
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Rechercher un organisme de formation, un accès, un e-mail…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {isLoading && <Card className="p-6 text-sm text-muted-foreground">Chargement…</Card>}
      {!isLoading && groups.length === 0 && (
        <Card className="p-8 text-center text-muted-foreground">Aucun accès enregistré.</Card>
      )}

      {groups.map(([organisme, items]) => (
        <Card key={organisme} className="overflow-hidden">
          <div className="flex items-center justify-between border-b bg-muted/30 p-3">
            <div className="font-medium">{organisme}</div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                title={`Ajouter un accès pour ${organisme}`}
                onClick={() => { setShowSecret(false); setForm({ ...EMPTY, organisme }); }}
              >
                <Plus className="h-4 w-4 mr-1" /> Ajouter un accès
              </Button>
              <Badge variant="secondary">{items.length} accès</Badge>
            </div>
          </div>
          <div className="divide-y">
            {items.map((r) => (
              <div key={r.id} className="flex flex-wrap items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.libelle}</div>
                  <div className="mt-1 text-sm text-muted-foreground break-all">
                    E-mail : <span className="font-mono">{r.identifiant || "—"}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Mot de passe :{" "}
                    {r.has_secret
                      ? (revealed[r.id]
                          ? <span className="font-mono text-foreground">{revealed[r.id]}</span>
                          : "••••••••")
                      : "—"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" title="Copier l'e-mail" onClick={() => doCopy(r.id, "identifiant")}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Copier le mot de passe" disabled={!r.has_secret} onClick={() => doCopy(r.id, "secret")}>
                    <ShieldCheck className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Afficher le mot de passe" disabled={!r.has_secret} onClick={() => doReveal(r.id)}>
                    {revealed[r.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost" size="icon" title="Modifier"
                    onClick={() => setForm({
                      id: r.id,
                      organisme: r.organisme ?? r.client_nom ?? "",
                      libelle: r.libelle,
                      identifiant: r.identifiant ?? "",
                      secret: "",
                    })}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" title="Supprimer"
                    onClick={() => { if (confirm("Supprimer cet accès ?")) deleteM.mutate(r.id); }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Modifier l'accès" : "Nouvel accès"}</DialogTitle>
            <DialogDescription>
              Le mot de passe est chiffré avant enregistrement. Laissez le champ vide pour conserver le mot de passe actuel.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="a-organisme">Organisme de formation *</Label>
                <Input
                  id="a-organisme"
                  value={form.organisme}
                  onChange={(e) => setForm({ ...form, organisme: e.target.value })}
                  placeholder="ALPHA FORMATION"
                />
              </div>
              <div>
                <Label htmlFor="a-libelle">Accès de quoi ? *</Label>
                <Input
                  id="a-libelle"
                  value={form.libelle}
                  onChange={(e) => setForm({ ...form, libelle: e.target.value })}
                  placeholder="EDOF, Kairos, boîte mail…"
                />
              </div>
              <div>
                <Label htmlFor="a-mail">E-mail / identifiant</Label>
                <Input
                  id="a-mail"
                  value={form.identifiant}
                  onChange={(e) => setForm({ ...form, identifiant: e.target.value })}
                  autoComplete="off"
                  placeholder="contact@alpha-formation.fr"
                />
              </div>
              <div>
                <Label htmlFor="a-mdp">Mot de passe</Label>
                <div className="relative">
                  <Input
                    id="a-mdp"
                    type={showSecret ? "text" : "password"}
                    value={form.secret}
                    onChange={(e) => setForm({ ...form, secret: e.target.value })}
                    autoComplete="new-password"
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full w-10"
                    title={showSecret ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                    onClick={() => setShowSecret((v) => !v)}
                  >
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Annuler</Button>
            <Button
              disabled={!form?.libelle || !form?.organisme || saveM.isPending}
              onClick={() => form && saveM.mutate(form)}
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

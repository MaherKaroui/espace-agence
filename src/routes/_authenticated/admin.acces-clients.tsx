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
import { usePagination, ListPagination } from "@/components/list-pagination";
import { logClic, useLogCopie, useLogOuverture, useLogSaisie } from "@/lib/audit-click";

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

  // Journal d'audit : chaque clic, recherche et copie manuelle de la page.
  useLogOuverture("acces_client.page_ouverte");
  useLogSaisie("acces_client.recherche", q);
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;
  const pageRef = useLogCopie<HTMLDivElement>(
    "acces_client.texte_copie",
    () => ({}),
    // Un mot de passe affiché puis copié à la main n'est jamais écrit en clair.
    (texte) => {
      const secrets = Object.values(revealedRef.current).filter(Boolean);
      if (!secrets.some((v) => texte.includes(v))) return null;
      return secrets.reduce((t, v) => t.split(v).join("[mot de passe masqué]"), texte);
    },
  );
  const ctx = (r: { id: string; organisme?: string | null; client_nom?: string | null; libelle: string; identifiant?: string | null }) => ({
    organisme: r.organisme || r.client_nom || "Non rattaché",
    libelle: r.libelle,
    identifiant: r.identifiant ?? null,
  });

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
      const r = (rows as Acces[]).find((x) => x.id === id);
      if (r) logClic("acces_client.mot_de_passe_masque", ctx(r), { entityType: "client_acces", entityId: id });
      clearTimeout(timers.current[id]!);
      setRevealed((r) => { const n = { ...r }; delete n[id]; return n; });
      return;
    }
    try {
      const res: any = await reveal({ data: { id, field: "secret", mode: "affichage" } });
      if (res?.error) {
        logClic("acces_client.affichage_refuse", { erreur: res.error }, { entityType: "client_acces", entityId: id, severity: "warning" });
        return toast.error(res.error);
      }
      const value = res?.value;
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
      const res: any = await reveal({ data: { id, field, mode: "copie" } });
      if (res?.error) {
        logClic("acces_client.copie_refusee", { champ: field, erreur: res.error }, { entityType: "client_acces", entityId: id, severity: "warning" });
        return toast.error(res.error);
      }
      const value = res?.value;
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

  const pager = usePagination(groups, 10);
  const pageVue = useRef(pager.page);
  useEffect(() => {
    if (pageVue.current === pager.page) return;
    pageVue.current = pager.page;
    logClic("acces_client.page_liste", {
      page: pager.page,
      organismes_affiches: pager.pageItems.map(([o]) => o),
    });
  }, [pager.page, pager.pageItems]);

  return (
    <div ref={pageRef} className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl flex items-center gap-2">
            <KeyRound className="h-6 w-6" /> Accès clients
          </h1>
          <p className="text-sm text-muted-foreground">
            Coffre-fort réservé à l'équipe. Mots de passe chiffrés, consultations journalisées.
          </p>
        </div>
        <Button onClick={() => { logClic("acces_client.nouvel_acces_ouvert"); setShowSecret(false); setForm({ ...EMPTY }); }}>
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

      {pager.pageItems.map(([organisme, items]) => (
        <Card key={organisme} className="overflow-hidden">
          <div className="flex items-center justify-between border-b bg-muted/30 p-3">
            <div className="font-medium">{organisme}</div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                title={`Ajouter un accès pour ${organisme}`}
                onClick={() => { logClic("acces_client.ajout_pour_organisme_ouvert", { organisme }); setShowSecret(false); setForm({ ...EMPTY, organisme }); }}
              >
                <Plus className="h-4 w-4 mr-1" /> Ajouter un accès
              </Button>
              <Badge variant="secondary">{items.length} accès</Badge>
            </div>
          </div>
          <div className="divide-y">
            {items.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-start gap-3 p-3"
                data-audit-id={r.id}
                data-audit-organisme={organisme}
                data-audit-libelle={r.libelle}
              >
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
                    onClick={() => { logClic("acces_client.modification_ouverte", ctx(r), { entityType: "client_acces", entityId: r.id }); setShowSecret(false); setForm({
                      id: r.id,
                      organisme: r.organisme ?? r.client_nom ?? "",
                      libelle: r.libelle,
                      identifiant: r.identifiant ?? "",
                      secret: "",
                    }); }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" title="Supprimer"
                    onClick={() => {
                      if (confirm("Supprimer cet accès ?")) {
                        logClic("acces_client.suppression_confirmee", ctx(r), { entityType: "client_acces", entityId: r.id, severity: "warning" });
                        deleteM.mutate(r.id);
                      } else {
                        logClic("acces_client.suppression_annulee", ctx(r), { entityType: "client_acces", entityId: r.id });
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      <ListPagination state={pager} label="organismes" />


      <Dialog
        open={!!form}
        onOpenChange={(o) => {
          if (!o) {
            if (form && !saveM.isPending) logClic("acces_client.formulaire_ferme", { organisme: form.organisme, libelle: form.libelle }, { entityType: "client_acces", entityId: form.id });
            setForm(null);
          }
        }}
      >
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
                    onClick={() => {
                      logClic(showSecret ? "acces_client.saisie_mot_de_passe_masquee" : "acces_client.saisie_mot_de_passe_affichee", { organisme: form.organisme, libelle: form.libelle }, { entityType: "client_acces", entityId: form.id });
                      setShowSecret((v) => !v);
                    }}
                  >
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (form) logClic("acces_client.formulaire_annule", { organisme: form.organisme, libelle: form.libelle }, { entityType: "client_acces", entityId: form.id });
                setForm(null);
              }}
            >
              Annuler
            </Button>
            <Button
              disabled={!form?.libelle || !form?.organisme || saveM.isPending}
              onClick={() => {
                if (!form) return;
                logClic(form.id ? "acces_client.enregistrement_modification" : "acces_client.enregistrement_creation", {
                  organisme: form.organisme,
                  libelle: form.libelle,
                  identifiant: form.identifiant || null,
                  mot_de_passe_saisi: !!form.secret,
                }, { entityType: "client_acces", entityId: form.id });
                saveM.mutate(form);
              }}
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

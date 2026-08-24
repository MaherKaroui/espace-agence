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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  KeyRound, Search, Plus, Pencil, Trash2, Copy, Eye, EyeOff, ShieldCheck, Slack, RefreshCw, Link2,
} from "lucide-react";
import {
  listClientAcces, saveClientAcces, deleteClientAcces, revealClientAcces,
} from "@/lib/client-acces.functions";
import {
  slackTestConnection, slackListChannels, slackScanChannels, slackImportAcces,
} from "@/lib/slack-acces.functions";

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
  client_id: null as string | null,
  organisme: "",
  libelle: "",
  plateforme: "",
  url: "",
  identifiant: "",
  secret: "",
  notes: "",
};

function AccesClients() {
  const qc = useQueryClient();
  const list = useServerFn(listClientAcces);
  const save = useServerFn(saveClientAcces);
  const del = useServerFn(deleteClientAcces);
  const reveal = useServerFn(revealClientAcces);

  const [q, setQ] = useState("");
  const [form, setForm] = useState<typeof EMPTY | null>(null);
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

  const { data: clients = [] } = useQuery({
    queryKey: ["acces-clients-options"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, prenom, nom, entreprise, email")
        .is("archived_at", null)
        .order("entreprise", { nullsFirst: false });
      return (data ?? []).map((c) => ({
        id: c.id,
        label: c.entreprise || `${c.prenom ?? ""} ${c.nom ?? ""}`.trim() || c.email,
      }));
    },
  });

  const saveM = useMutation({
    mutationFn: (input: typeof EMPTY) =>
      save({
        data: {
          id: input.id,
          client_id: input.client_id,
          organisme: input.organisme || null,
          libelle: input.libelle,
          plateforme: input.plateforme || null,
          url: input.url || null,
          identifiant: input.identifiant || null,
          secret: input.secret || null,
          notes: input.notes || null,
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
      if (!value) return toast.info("Aucun secret enregistré pour cet accès");
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
      toast.success(field === "secret" ? "Secret copié" : "Identifiant copié");
    } catch (e: any) {
      toast.error(e?.message ?? "Copie impossible");
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r: Acces) =>
      [r.client_nom, r.organisme, r.plateforme, r.libelle, r.url]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  const groups = useMemo(() => {
    const map = new Map<string, Acces[]>();
    for (const r of filtered as Acces[]) {
      const key = r.client_nom || r.organisme || "Non rattaché";
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
            Coffre-fort réservé à l'équipe. Secrets chiffrés, consultations journalisées.
          </p>
        </div>
        <Button onClick={() => setForm({ ...EMPTY })}>
          <Plus className="h-4 w-4 mr-1" /> Nouvel accès
        </Button>
      </div>

      <Tabs defaultValue="coffre">
        <TabsList>
          <TabsTrigger value="coffre">Coffre-fort</TabsTrigger>
          <TabsTrigger value="slack"><Slack className="h-4 w-4 mr-1" /> Import Slack</TabsTrigger>
        </TabsList>

        <TabsContent value="coffre" className="space-y-4 pt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Rechercher un client, un organisme, une plateforme, un libellé…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {isLoading && <Card className="p-6 text-sm text-muted-foreground">Chargement…</Card>}
          {!isLoading && groups.length === 0 && (
            <Card className="p-8 text-center text-muted-foreground">Aucun accès enregistré.</Card>
          )}

          {groups.map(([client, items]) => (
            <Card key={client} className="overflow-hidden">
              <div className="flex items-center justify-between border-b bg-muted/30 p-3">
                <div className="font-medium">{client}</div>
                <Badge variant="secondary">{items.length} accès</Badge>
              </div>
              <div className="divide-y">
                {items.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-start gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{r.libelle}</span>
                        {r.plateforme && <Badge variant="outline">{r.plateforme}</Badge>}
                        <Badge variant={r.source === "slack" ? "secondary" : "outline"}>
                          {r.source === "slack" ? `Slack${r.slack_channel ? "" : ""}` : "Manuel"}
                        </Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground break-all">
                        {r.identifiant ? <>Identifiant : <span className="font-mono">{r.identifiant}</span></> : "Aucun identifiant"}
                        {" · "}
                        Secret : {r.has_secret ? (revealed[r.id] ? <span className="font-mono text-foreground">{revealed[r.id]}</span> : "••••••••") : "—"}
                      </div>
                      {r.url && (
                        <a href={r.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline">
                          <Link2 className="h-3 w-3" /> {r.url}
                        </a>
                      )}
                      {r.notes && <div className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{r.notes}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="icon" title="Copier l'identifiant" onClick={() => doCopy(r.id, "identifiant")}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Copier le secret" disabled={!r.has_secret} onClick={() => doCopy(r.id, "secret")}>
                        <ShieldCheck className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Révéler le secret" disabled={!r.has_secret} onClick={() => doReveal(r.id)}>
                        {revealed[r.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost" size="icon" title="Modifier"
                        onClick={() => setForm({
                          id: r.id,
                          client_id: r.client_id,
                          organisme: r.organisme ?? "",
                          libelle: r.libelle,
                          plateforme: r.plateforme ?? "",
                          url: r.url ?? "",
                          identifiant: r.identifiant ?? "",
                          secret: "",
                          notes: r.notes ?? "",
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
        </TabsContent>

        <TabsContent value="slack" className="pt-4">
          <SlackPanel onImported={() => qc.invalidateQueries({ queryKey: ["client-acces"] })} clients={clients} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Modifier l'accès" : "Nouvel accès"}</DialogTitle>
            <DialogDescription>
              Le secret est chiffré avant enregistrement. Laissez le champ vide pour conserver le secret actuel.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div>
                <Label>Client</Label>
                <Select
                  value={form.client_id ?? "none"}
                  onValueChange={(v) => setForm({ ...form, client_id: v === "none" ? null : v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Non rattaché</SelectItem>
                    {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Organisme (si non client)</Label>
                <Input value={form.organisme} onChange={(e) => setForm({ ...form, organisme: e.target.value })} placeholder="ALPHA FORMATION" />
              </div>
              <div>
                <Label>Libellé *</Label>
                <Input value={form.libelle} onChange={(e) => setForm({ ...form, libelle: e.target.value })} placeholder="Espace EDOF" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Plateforme</Label>
                  <Input value={form.plateforme} onChange={(e) => setForm({ ...form, plateforme: e.target.value })} />
                </div>
                <div>
                  <Label>Adresse (URL)</Label>
                  <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Identifiant</Label>
                  <Input value={form.identifiant} onChange={(e) => setForm({ ...form, identifiant: e.target.value })} autoComplete="off" />
                </div>
                <div>
                  <Label>Secret</Label>
                  <Input type="password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} autoComplete="new-password" />
                </div>
              </div>
              <div>
                <Label>Notes (non sensibles)</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Annuler</Button>
            <Button
              disabled={!form?.libelle || saveM.isPending}
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

/* ===================== Panneau Slack ===================== */

type Candidate = Awaited<ReturnType<typeof slackScanChannels>>[number];

function SlackPanel({ onImported, clients }: { onImported: () => void; clients: { id: string; label: string }[] }) {
  const test = useServerFn(slackTestConnection);
  const listCh = useServerFn(slackListChannels);
  const scan = useServerFn(slackScanChannels);
  const imp = useServerFn(slackImportAcces);

  const [selected, setSelected] = useState<Record<string, string>>({});
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, Partial<Candidate>>>({});

  const { data: settings } = useQuery({
    queryKey: ["acces-slack-settings"],
    queryFn: async () => {
      const { data } = await supabase.from("client_acces_slack_settings").select("channels").eq("id", 1).maybeSingle();
      return (data?.channels ?? []) as { id: string; name: string }[];
    },
  });

  useEffect(() => {
    if (settings?.length) setSelected(Object.fromEntries(settings.map((c) => [c.id, c.name])));
  }, [settings]);

  const testM = useMutation({
    mutationFn: () => test({}),
    onSuccess: (r) => toast.success(`Connecté à l'espace « ${r.team} » (bot ${r.bot})`),
    onError: (e: any) => toast.error(e?.message ?? "Connexion Slack impossible"),
  });

  const channelsM = useMutation({
    mutationFn: () => listCh({}),
    onError: (e: any) => toast.error(e?.message ?? "Lecture des canaux impossible"),
  });

  const scanM = useMutation({
    mutationFn: () => scan({ data: { channels: Object.entries(selected).map(([id, name]) => ({ id, name })) } }),
    onSuccess: (rows) => {
      setCandidates(rows);
      setKeep(Object.fromEntries(rows.map((r) => [`${r.channel_id}::${r.message_ts}`, !r.deja_present])));
      if (rows.length === 0) toast.info("Aucun accès détecté dans les canaux retenus");
    },
    onError: (e: any) => toast.error(e?.message ?? "Analyse impossible"),
  });

  const importM = useMutation({
    mutationFn: () => {
      const rows = (candidates ?? [])
        .filter((c) => keep[`${c.channel_id}::${c.message_ts}`])
        .map((c) => {
          const o = overrides[`${c.channel_id}::${c.message_ts}`] ?? {};
          return {
            channel_id: c.channel_id,
            channel_name: c.channel_name,
            message_ts: c.message_ts,
            libelle: (o.libelle ?? c.libelle) || `Accès ${c.channel_name}`,
            plateforme: o.plateforme ?? c.plateforme,
            url: c.url,
            identifiant: o.identifiant ?? c.identifiant,
            secret: c.secret,
            client_id: o.client_id !== undefined ? o.client_id : c.client_id,
            organisme: (o.client_id !== undefined ? o.client_id : c.client_id) ? null : c.organisme,
          };
        });
      if (rows.length === 0) throw new Error("Aucune ligne sélectionnée");
      return imp({ data: { rows } });
    },
    onSuccess: (r) => {
      toast.success(`${r.created} créés, ${r.updated} mis à jour, ${r.ignored} ignorés (saisis à la main)`);
      setCandidates(null);
      onImported();
    },
    onError: (e: any) => toast.error(e?.message ?? "Import impossible"),
  });

  const saveChannels = async () => {
    const channels = Object.entries(selected).map(([id, name]) => ({ id, name }));
    const { error } = await supabase
      .from("client_acces_slack_settings")
      .update({ channels, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) toast.error("Enregistrement des canaux impossible (réservé à la direction)");
    else toast.success("Canaux enregistrés");
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4 text-sm">
        <div className="font-medium">Préparation côté Slack</div>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Créez (ou régénérez) votre application Slack et activez les portées bot : <code>channels:read</code>, <code>channels:history</code>, <code>groups:read</code>, <code>groups:history</code>.</li>
          <li>Installez l'application dans votre espace, puis <strong>invitez le bot dans chaque canal</strong> à analyser (<code>/invite @votre-bot</code>).</li>
          <li>Enregistrez le jeton du bot dans les secrets du projet sous <code>SLACK_BOT_TOKEN</code> (et le secret de signature sous <code>SLACK_SIGNING_SECRET</code>). Aucun secret n'est écrit dans le code.</li>
        </ol>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => testM.mutate()} disabled={testM.isPending}>
            Tester la connexion
          </Button>
          <Button size="sm" variant="outline" onClick={() => channelsM.mutate()} disabled={channelsM.isPending}>
            <RefreshCw className="h-4 w-4 mr-1" /> Lister les canaux
          </Button>
        </div>
      </Card>

      {channelsM.data && (
        <Card className="p-4">
          <div className="mb-2 font-medium">Canaux à analyser</div>
          <div className="grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2">
            {channelsM.data.map((c) => (
              <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50">
                <Checkbox
                  checked={!!selected[c.id]}
                  onCheckedChange={(v) =>
                    setSelected((s) => {
                      const n = { ...s };
                      if (v) n[c.id] = c.name; else delete n[c.id];
                      return n;
                    })
                  }
                />
                <span className="truncate">#{c.name}</span>
                {c.is_private && <Badge variant="outline" className="text-[10px]">privé</Badge>}
                {!c.is_member && <Badge variant="secondary" className="text-[10px]">bot non invité</Badge>}
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" onClick={saveChannels}>Enregistrer la sélection</Button>
            <Button size="sm" onClick={() => scanM.mutate()} disabled={!Object.keys(selected).length || scanM.isPending}>
              Analyser ({Object.keys(selected).length})
            </Button>
          </div>
        </Card>
      )}

      {candidates && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b bg-muted/30 p-3">
            <div className="font-medium">Prévisualisation — {candidates.length} accès détectés</div>
            <Button size="sm" onClick={() => importM.mutate()} disabled={importM.isPending}>
              Enregistrer la sélection
            </Button>
          </div>
          <div className="divide-y">
            {candidates.map((c) => {
              const key = `${c.channel_id}::${c.message_ts}`;
              const o = overrides[key] ?? {};
              return (
                <div key={key} className="space-y-2 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Checkbox checked={!!keep[key]} onCheckedChange={(v) => setKeep((k) => ({ ...k, [key]: !!v }))} />
                    <span className="font-medium">#{c.channel_name}</span>
                    {c.deja_present && <Badge variant="secondary">déjà importé</Badge>}
                  </div>
                  <div className="rounded bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                    {c.extrait.replace(c.secret ?? "\u0000", "••••••••")}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input
                      value={o.libelle ?? c.libelle}
                      onChange={(e) => setOverrides((s) => ({ ...s, [key]: { ...o, libelle: e.target.value } }))}
                      placeholder="Libellé"
                    />
                    <Input
                      value={o.identifiant ?? c.identifiant ?? ""}
                      onChange={(e) => setOverrides((s) => ({ ...s, [key]: { ...o, identifiant: e.target.value } }))}
                      placeholder="Identifiant"
                    />
                    <Select
                      value={(o.client_id !== undefined ? o.client_id : c.client_id) ?? "none"}
                      onValueChange={(v) => setOverrides((s) => ({ ...s, [key]: { ...o, client_id: v === "none" ? null : v } }))}
                    >
                      <SelectTrigger><SelectValue placeholder="Client" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Non rattaché</SelectItem>
                        {clients.map((cl) => <SelectItem key={cl.id} value={cl.id}>{cl.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Secret détecté : {c.secret ? "oui (masqué, chiffré à l'enregistrement)" : "non"}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

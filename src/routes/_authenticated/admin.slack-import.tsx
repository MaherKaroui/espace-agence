import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import type JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Archive, AlertTriangle, Download, FileWarning, Link2, Search, Slack, Upload, KeyRound,
  CheckCircle2, Loader2,
} from "lucide-react";
import { analyseArchive, runImport, type ArchiveSummary } from "@/lib/slack-archive";
import {
  slackSuggestChannelClients, slackScanArchiveAcces, slackImportArchiveAcces,
  slackDownloadFiles,
} from "@/lib/slack-archive.functions";

export const Route = createFileRoute("/_authenticated/admin/slack-import")({
  head: () => ({
    meta: [
      { title: "Reprise Slack — IZISuivis" },
      { name: "description", content: "Importer l'archive d'export Slack et rapatrier canaux, messages, fichiers et accès dans IZISuivis." },
      { property: "og:title", content: "Reprise Slack — IZISuivis" },
      { property: "og:description", content: "Importer l'archive d'export Slack et rapatrier l'historique dans IZISuivis." },
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
  component: SlackImportPage,
});

function octets(n: number) {
  if (!n) return "0 o";
  const u = ["o", "ko", "Mo", "Go"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function SlackImportPage() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Slack className="h-6 w-6" /> Reprise des données Slack
        </h1>
        <p className="text-sm text-muted-foreground">
          Import de l'archive d'export officielle Slack : canaux, messages, membres, fichiers et accès.
        </p>
      </header>

      <Card className="border-amber-500/40 bg-amber-500/5 p-4 space-y-2">
        <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" /> À lire avant de résilier Slack
        </div>
        <ul className="text-sm space-y-1 list-disc pl-5 text-muted-foreground">
          <li>Réalisez l'export <strong>avant</strong> toute résiliation ou passage à une offre réduite.</li>
          <li>
            Selon l'offre, l'export standard ne contient <strong>que les canaux publics</strong>. Les canaux
            privés et les messages directs demandent une autorisation particulière à Slack : vérifiez-le
            avant de résilier, sinon ces contenus seront perdus.
          </li>
          <li>
            Les <strong>fichiers partagés ne sont pas dans l'archive</strong> : seules leurs adresses y figurent, et
            elles cesseront de fonctionner après la résiliation. Rapatriez-les depuis l'onglet « Fichiers »
            tant que l'abonnement est actif.
          </li>
          <li>Conservez l'archive ZIP d'origine en sauvegarde, indépendamment de cet import.</li>
        </ul>
      </Card>

      <Tabs defaultValue="import">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="import"><Upload className="h-4 w-4 mr-1" /> Import</TabsTrigger>
          <TabsTrigger value="rapprochement"><Link2 className="h-4 w-4 mr-1" /> Rapprochement clients</TabsTrigger>
          <TabsTrigger value="fichiers"><FileWarning className="h-4 w-4 mr-1" /> Fichiers</TabsTrigger>
          <TabsTrigger value="acces"><KeyRound className="h-4 w-4 mr-1" /> Accès détectés</TabsTrigger>
          <TabsTrigger value="recherche"><Search className="h-4 w-4 mr-1" /> Historique</TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="pt-4"><ImportPanel /></TabsContent>
        <TabsContent value="rapprochement" className="pt-4"><RapprochementPanel /></TabsContent>
        <TabsContent value="fichiers" className="pt-4"><FichiersPanel /></TabsContent>
        <TabsContent value="acces" className="pt-4"><AccesPanel /></TabsContent>
        <TabsContent value="recherche" className="pt-4"><RecherchePanel /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================= 1. IMPORT ============================= */

function ImportPanel() {
  const qc = useQueryClient();
  const zipRef = useRef<JSZip | null>(null);
  const stopRef = useRef(false);
  const [summary, setSummary] = useState<ArchiveSummary | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analyseProg, setAnalyseProg] = useState({ done: 0, total: 0 });
  const [running, setRunning] = useState(false);
  const [prog, setProg] = useState({ phase: "", done: 0, total: 0, messages: 0 });
  const [confirmOpen, setConfirmOpen] = useState(false);

  const imports = useQuery({
    queryKey: ["slack-imports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slack_imports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  const repriseCandidate = useMemo(
    () =>
      (imports.data ?? []).find(
        (i: any) => i.statut === "en_cours" && summary && i.archive_nom === summary.archiveNom,
      ) ?? null,
    [imports.data, summary],
  );

  async function onFile(file: File) {
    setSummary(null);
    setAnalysing(true);
    setAnalyseProg({ done: 0, total: 0 });
    try {
      const { zip, summary } = await analyseArchive(file, (done, total) =>
        setAnalyseProg({ done, total }),
      );
      zipRef.current = zip;
      setSummary(summary);
      setConfirmOpen(true);
    } catch (e: any) {
      toast.error(`Archive illisible : ${e?.message ?? e}`);
    } finally {
      setAnalysing(false);
    }
  }

  async function lancer() {
    if (!summary || !zipRef.current) return;
    setConfirmOpen(false);
    setRunning(true);
    stopRef.current = false;
    try {
      let importId = repriseCandidate?.id as string | undefined;
      let deja: string[] = (repriseCandidate?.fichiers_traites as string[]) ?? [];
      if (!importId) {
        const { data: u } = await supabase.auth.getUser();
        const { data, error } = await supabase
          .from("slack_imports")
          .insert({
            archive_nom: summary.archiveNom,
            statut: "en_cours",
            canaux_count: summary.canaux.length,
            membres_count: summary.membres.length,
            messages_count: summary.messagesCount,
            fichiers_count: summary.fichiersCount,
            fichiers_taille: summary.fichiersTaille,
            date_min: summary.dateMin,
            date_max: summary.dateMax,
            created_by: u.user?.id ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;
        importId = data.id;
        deja = [];
      }
      const res = await runImport(
        zipRef.current,
        summary,
        importId!,
        deja,
        (p) => setProg(p),
        () => stopRef.current,
      );
      if (res.interrompu) toast.warning("Import interrompu — il reprendra où il s'est arrêté.");
      else toast.success(`Import terminé : ${res.messages} messages enregistrés.`);
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(`Import interrompu : ${e?.message ?? e}. Relancez la même archive pour reprendre.`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-6 space-y-4">
        <div>
          <p className="font-medium">Archive d'export Slack (.zip)</p>
          <p className="text-sm text-muted-foreground">
            Slack → Réglages de l'espace de travail → Importer/Exporter des données → Exporter.
          </p>
        </div>
        <Input
          type="file"
          accept=".zip,application/zip"
          disabled={analysing || running}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
        {analysing && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Analyse de l'archive… {analyseProg.done}/{analyseProg.total || "?"} journées
          </p>
        )}
        {running && (
          <div className="space-y-1">
            <p className="text-sm">
              {prog.phase} — {prog.done}/{prog.total} ({prog.messages} messages)
            </p>
            <div className="h-2 rounded bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }}
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => { stopRef.current = true; }}>
              Interrompre (reprise possible)
            </Button>
          </div>
        )}
        {summary && !running && (
          <Button onClick={() => setConfirmOpen(true)}>
            <Archive className="h-4 w-4 mr-1" /> Revoir le bilan et importer
          </Button>
        )}
      </Card>

      <Card className="p-4">
        <p className="font-medium mb-2">Imports précédents</p>
        {(imports.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun import pour le moment.</p>
        ) : (
          <div className="space-y-2 text-sm">
            {(imports.data ?? []).map((i: any) => (
              <div key={i.id} className="flex flex-wrap items-center gap-2 border-b pb-2 last:border-0">
                <Badge variant={i.statut === "termine" ? "secondary" : "outline"}>
                  {i.statut === "termine" ? "Terminé" : "En cours"}
                </Badge>
                <span className="font-medium">{i.archive_nom}</span>
                <span className="text-muted-foreground">
                  {i.canaux_count} canaux · {i.messages_count} messages · {i.membres_count} membres
                  {i.date_min ? ` · ${i.date_min} → ${i.date_max}` : ""}
                </span>
                <span className="text-muted-foreground">
                  {((i.fichiers_traites as string[]) ?? []).length} journées traitées
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Bilan de l'archive</DialogTitle>
            <DialogDescription>Rien n'est enregistré tant que vous ne confirmez pas.</DialogDescription>
          </DialogHeader>
          {summary && (
            <div className="space-y-2 text-sm">
              <Ligne l="Archive" v={summary.archiveNom} />
              <Ligne l="Canaux" v={String(summary.canaux.length)} />
              <Ligne l="Membres" v={String(summary.membres.length)} />
              <Ligne l="Messages" v={summary.messagesCount.toLocaleString("fr-FR")} />
              <Ligne l="Période" v={summary.dateMin ? `${summary.dateMin} → ${summary.dateMax}` : "—"} />
              <Ligne
                l="Fichiers référencés"
                v={`${summary.fichiersCount} (${octets(summary.fichiersTaille)})`}
              />
              <Ligne l="Canaux privés inclus" v={summary.contientPrives ? "oui" : "non"} />
              <Ligne l="Messages directs inclus" v={summary.contientDMs ? "oui" : "non"} />
              {!summary.contientPrives && (
                <p className="text-amber-600 dark:text-amber-400">
                  Cette archive ne contient aucun canal privé. S'il en existe d'importants, demandez
                  l'export étendu à Slack avant de résilier.
                </p>
              )}
              {repriseCandidate && (
                <p className="text-muted-foreground">
                  Un import inachevé de cette archive existe :{" "}
                  {((repriseCandidate.fichiers_traites as string[]) ?? []).length} journées déjà traitées.
                  L'import reprendra à la suite, sans doublon.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Annuler</Button>
            <Button onClick={() => void lancer()}>Confirmer et importer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Ligne({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b pb-1 last:border-0">
      <span className="text-muted-foreground">{l}</span>
      <span className="font-medium text-right">{v}</span>
    </div>
  );
}

/* ======================= 2. RAPPROCHEMENT CLIENTS ======================= */

function RapprochementPanel() {
  const qc = useQueryClient();
  const suggest = useServerFn(slackSuggestChannelClients);
  const [q, setQ] = useState("");

  const canaux = useQuery({ queryKey: ["slack-rapprochement"], queryFn: () => suggest() });
  const clients = useQuery({
    queryKey: ["slack-clients-liste"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, prenom, nom, entreprise, email")
        .is("archived_at", null)
        .order("entreprise");
      return (data ?? []).map((c: any) => ({
        id: c.id as string,
        label: (c.entreprise || `${c.prenom ?? ""} ${c.nom ?? ""}`.trim() || c.email) as string,
      }));
    },
  });

  const rattacher = useMutation({
    mutationFn: async ({ id, clientId }: { id: string; clientId: string | null }) => {
      const { error } = await supabase
        .from("slack_canaux")
        .update({ client_id: clientId, rapprochement_valide: !!clientId })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rattachement enregistré");
      qc.invalidateQueries({ queryKey: ["slack-rapprochement"] });
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  const rows = (canaux.data ?? []).filter((c: any) =>
    !q || c.nom.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input placeholder="Filtrer les canaux…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {canaux.isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun canal importé pour le moment.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((c: any) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 border-b pb-2 last:border-0">
              <span className="font-medium">#{c.nom}</span>
              <Badge variant="outline">{c.type}</Badge>
              {c.client_id ? (
                <Badge variant="secondary"><CheckCircle2 className="h-3 w-3 mr-1" /> rattaché</Badge>
              ) : c.suggestion_nom ? (
                <span className="text-xs text-muted-foreground">Suggestion : {c.suggestion_nom}</span>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
                <Select
                  value={c.client_id ?? "aucun"}
                  onValueChange={(v) => rattacher.mutate({ id: c.id, clientId: v === "aucun" ? null : v })}
                >
                  <SelectTrigger className="w-64"><SelectValue placeholder="Client" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aucun">Aucun client</SelectItem>
                    {(clients.data ?? []).map((cl) => (
                      <SelectItem key={cl.id} value={cl.id}>{cl.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!c.client_id && c.suggestion_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => rattacher.mutate({ id: c.id, clientId: c.suggestion_id })}
                  >
                    Valider la suggestion
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ============================ 3. FICHIERS ============================ */

function FichiersPanel() {
  const qc = useQueryClient();
  const dl = useServerFn(slackDownloadFiles);
  const [running, setRunning] = useState(false);
  const [prog, setProg] = useState({ done: 0, total: 0 });

  const fichiers = useQuery({
    queryKey: ["slack-fichiers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slack_fichiers")
        .select("id, nom, mimetype, taille, storage_path, erreur, downloaded_at")
        .order("taille", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const stats = useMemo(() => {
    const rows = fichiers.data ?? [];
    const total = rows.length;
    const rapatries = rows.filter((f: any) => f.storage_path).length;
    const taille = rows.reduce((s: number, f: any) => s + Number(f.taille || 0), 0);
    return { total, rapatries, taille };
  }, [fichiers.data]);

  async function rapatrier() {
    const restants = (fichiers.data ?? []).filter((f: any) => !f.storage_path).map((f: any) => f.id);
    if (!restants.length) { toast.info("Tous les fichiers connus sont déjà rapatriés."); return; }
    setRunning(true);
    setProg({ done: 0, total: restants.length });
    let ok = 0, echecs = 0;
    try {
      for (let i = 0; i < restants.length; i += 5) {
        const lot = restants.slice(i, i + 5);
        const r = await dl({ data: { ids: lot } });
        ok += r.ok; echecs += r.echecs;
        setProg({ done: Math.min(i + 5, restants.length), total: restants.length });
      }
      toast.success(`Rapatriement : ${ok} fichiers récupérés, ${echecs} en échec.`);
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setRunning(false);
      qc.invalidateQueries({ queryKey: ["slack-fichiers"] });
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p className="font-medium flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" /> Ces fichiers seront définitivement perdus après la résiliation
        </p>
        <p className="text-muted-foreground mt-1">
          L'export Slack ne contient que les adresses des fichiers, pas les fichiers eux-mêmes.
          Lancez le rapatriement <strong>tant que l'abonnement Slack est actif</strong> et que le jeton du
          bot fonctionne encore.
        </p>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-4 text-sm">
          <span><strong>{stats.total}</strong> fichiers référencés</span>
          <span><strong>{octets(stats.taille)}</strong> au total</span>
          <span><strong>{stats.rapatries}</strong> déjà dans IZISuivis</span>
        </div>
        <Button onClick={() => void rapatrier()} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
          Rapatrier les fichiers manquants
        </Button>
        {running && <p className="text-sm text-muted-foreground">{prog.done}/{prog.total}</p>}
      </Card>

      <Card className="p-4">
        <div className="space-y-1 text-sm max-h-[420px] overflow-auto">
          {(fichiers.data ?? []).map((f: any) => (
            <div key={f.id} className="flex items-center gap-2 border-b py-1 last:border-0">
              <span className="truncate flex-1">{f.nom ?? "sans nom"}</span>
              <span className="text-muted-foreground">{octets(Number(f.taille || 0))}</span>
              {f.storage_path ? (
                <Badge variant="secondary">rapatrié</Badge>
              ) : f.erreur ? (
                <Badge variant="destructive" title={f.erreur}>échec</Badge>
              ) : (
                <Badge variant="outline">à récupérer</Badge>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ========================= 4. ACCÈS DÉTECTÉS ========================= */

function AccesPanel() {
  const scan = useServerFn(slackScanArchiveAcces);
  const imp = useServerFn(slackImportArchiveAcces);
  const [rows, setRows] = useState<any[] | null>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const clients = useQuery({
    queryKey: ["slack-clients-liste"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, prenom, nom, entreprise, email")
        .is("archived_at", null);
      return (data ?? []).map((c: any) => ({
        id: c.id as string,
        label: (c.entreprise || `${c.prenom ?? ""} ${c.nom ?? ""}`.trim() || c.email) as string,
      }));
    },
  });

  async function analyser() {
    setBusy(true);
    try {
      const r = await scan({ data: {} });
      setRows(r);
      const next: Record<string, boolean> = {};
      r.forEach((c: any) => { next[`${c.channel_id}::${c.message_ts}`] = !c.deja_present; });
      setSel(next);
      toast.success(`${r.length} accès potentiels détectés dans l'historique importé.`);
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function importer() {
    const chosen = (rows ?? []).filter((r) => sel[`${r.channel_id}::${r.message_ts}`]);
    if (!chosen.length) { toast.info("Aucune ligne sélectionnée."); return; }
    setBusy(true);
    try {
      const res = await imp({ data: { rows: chosen.map(({ extrait, client_nom, deja_present, ...r }) => r) } });
      toast.success(`${res.created} créés, ${res.updated} mis à jour, ${res.ignored} ignorés (verrouillés).`);
      await analyser();
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void analyser()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
          Analyser l'historique importé
        </Button>
        {rows && (
          <Button variant="secondary" onClick={() => void importer()} disabled={busy}>
            <KeyRound className="h-4 w-4 mr-1" /> Importer la sélection dans le coffre-fort
          </Button>
        )}
        <Link to="/admin/acces-clients" className="text-sm underline ml-auto">
          Ouvrir la page Accès clients
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        Les secrets sont chiffrés à l'enregistrement, masqués par défaut, journalisés à chaque
        consultation, et hors de portée de l'assistant IA.
      </p>

      {rows && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucun accès détecté dans les messages importés.</p>
      )}

      {rows && rows.length > 0 && (
        <div className="space-y-2 max-h-[520px] overflow-auto">
          {rows.map((r) => {
            const key = `${r.channel_id}::${r.message_ts}`;
            return (
              <div key={key} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={!!sel[key]}
                    onCheckedChange={(v) => setSel((s) => ({ ...s, [key]: !!v }))}
                  />
                  <span className="font-medium">#{r.channel_name}</span>
                  {r.deja_present && <Badge variant="outline">déjà importé</Badge>}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {r.client_nom ?? "client non identifié"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {r.extrait.replace(r.secret ?? "\u0000", "••••••••")}
                </p>
                <div className="grid gap-2 md:grid-cols-3">
                  <Input
                    value={r.libelle}
                    onChange={(e) =>
                      setRows((s) => s!.map((x) => (x === r ? { ...x, libelle: e.target.value } : x)))
                    }
                    placeholder="Libellé"
                  />
                  <Input
                    value={r.identifiant ?? ""}
                    onChange={(e) =>
                      setRows((s) => s!.map((x) => (x === r ? { ...x, identifiant: e.target.value } : x)))
                    }
                    placeholder="Identifiant"
                  />
                  <Select
                    value={r.client_id ?? "aucun"}
                    onValueChange={(v) =>
                      setRows((s) =>
                        s!.map((x) => (x === r ? { ...x, client_id: v === "aucun" ? null : v } : x)),
                      )
                    }
                  >
                    <SelectTrigger><SelectValue placeholder="Client" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="aucun">Aucun client</SelectItem>
                      {(clients.data ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ========================== 5. RECHERCHE ========================== */

function RecherchePanel() {
  const [q, setQ] = useState("");
  const [terme, setTerme] = useState("");

  const res = useQuery({
    queryKey: ["slack-recherche", terme],
    enabled: terme.length > 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slack_messages")
        .select("id, auteur, texte, posted_at, slack_canaux(nom)")
        .textSearch("recherche", terme, { type: "websearch", config: "french" })
        .order("posted_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card className="p-4 space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); setTerme(q.trim()); }}
      >
        <Input placeholder="Rechercher dans tout l'historique Slack…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit"><Search className="h-4 w-4" /></Button>
      </form>
      {res.isFetching && <p className="text-sm text-muted-foreground">Recherche…</p>}
      <div className="space-y-2 max-h-[520px] overflow-auto">
        {(res.data ?? []).map((m: any) => (
          <div key={m.id} className="border-b pb-2 last:border-0">
            <p className="text-xs text-muted-foreground">
              #{m.slack_canaux?.nom} · {m.auteur} ·{" "}
              {m.posted_at ? new Date(m.posted_at).toLocaleString("fr-FR") : ""}
            </p>
            <p className="text-sm whitespace-pre-wrap">{m.texte}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

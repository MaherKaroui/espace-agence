import { useMemo, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Activity, AlertTriangle, Bot, CheckCircle2, Gauge, Loader2, RefreshCw, ServerCrash, Timer, WifiOff,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import {
  getSupervisionOverview, runSupervisionNow, setErrorStatus, setSuggestionStatus,
} from "@/lib/supervision.functions";

export const Route = createFileRoute("/_authenticated/admin/agent-ia")({
  head: () => ({
    meta: [
      { title: "Agent IA — Supervision — IZISuivis" },
      { name: "description", content: "Supervision automatique de l'application : santé du site, erreurs détectées, anomalies de données et suggestions d'amélioration par IA." },
      { property: "og:title", content: "Agent IA — Supervision — IZISuivis" },
      { property: "og:description", content: "Diagnostic quotidien, erreurs et suggestions d'amélioration générés automatiquement." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    if (!roles?.some((r) => r.role === "admin")) throw redirect({ to: "/dashboard" });
  },
  component: AgentIaPage,
});

const GRAVITE_VARIANT: Record<string, string> = {
  critique: "bg-destructive/15 text-destructive border-destructive/30",
  majeur: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400",
  mineur: "bg-muted text-muted-foreground border-border",
};

const STATUT_LABEL: Record<string, string> = { nouveau: "Nouveau", vu: "Vu", resolu: "Résolu" };

function fmt(d?: string | null) {
  return d ? format(new Date(d), "dd/MM/yyyy HH:mm", { locale: fr }) : "—";
}

function scoreColor(score: number | null) {
  if (score === null) return "text-muted-foreground";
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

function AgentIaPage() {
  const qc = useQueryClient();
  const fetchOverview = useServerFn(getSupervisionOverview);
  const runNow = useServerFn(runSupervisionNow);
  const updateError = useServerFn(setErrorStatus);
  const updateSuggestion = useServerFn(setSuggestionStatus);

  const [graviteFilter, setGraviteFilter] = useState<string>("all");
  const [statutFilter, setStatutFilter] = useState<string>("all");
  const [detail, setDetail] = useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["supervision-overview"],
    queryFn: () => fetchOverview({ data: undefined as any }),
    refetchInterval: 60_000,
  });

  const runMutation = useMutation({
    mutationFn: () => runNow({ data: undefined as any }),
    onSuccess: (r: any) => {
      toast.success(`Analyse terminée — score ${r.score}/100`);
      qc.invalidateQueries({ queryKey: ["supervision-overview"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Analyse impossible"),
  });

  const errorMutation = useMutation({
    mutationFn: (v: { id: string; statut: "nouveau" | "vu" | "resolu" }) => updateError({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["supervision-overview"] }),
  });

  const suggestionMutation = useMutation({
    mutationFn: (v: { id: string; statut: "nouveau" | "a_faire" | "ignoree" }) => updateSuggestion({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["supervision-overview"] }),
  });

  const errors = useMemo(() => {
    const list = (data?.errors ?? []) as any[];
    return list.filter((e) =>
      (graviteFilter === "all" || e.gravite === graviteFilter) &&
      (statutFilter === "all" || (e.statut ?? "nouveau") === statutFilter));
  }, [data, graviteFilter, statutFilter]);

  const anomalies = (data?.anomalies ?? []) as any[];
  const suggestions = (data?.suggestions ?? []) as any[];
  const problems = (data?.problems ?? []) as any[];
  const anomaliesTotal = anomalies.reduce((s, a) => s + (a.count ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl flex items-center gap-2">
            <Bot className="h-6 w-6 text-gold" /> Agent IA — Supervision
          </h1>
          <p className="text-sm text-muted-foreground">
            Surveillance continue de l'application, détection d'erreurs et suggestions d'amélioration.
          </p>
        </div>
        <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
          {runMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Lancer une analyse maintenant
        </Button>
      </div>

      {/* Bandeau */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"><Gauge className="h-4 w-4" /> Santé</div>
          <div className={`mt-2 text-3xl font-semibold ${scoreColor(data?.score ?? null)}`}>
            {data?.score ?? "—"}<span className="text-base text-muted-foreground">/100</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{data?.reportDate ? `Rapport du ${data.reportDate}` : "Aucun rapport"}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            {data?.siteUp === false ? <WifiOff className="h-4 w-4" /> : <Activity className="h-4 w-4" />} Site
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {data?.siteUp === null || data?.siteUp === undefined ? "—" : data.siteUp ? "En ligne" : "Hors ligne"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Dernier contrôle : {fmt(data?.lastCheckAt)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"><Timer className="h-4 w-4" /> Temps de réponse</div>
          <div className="mt-2 text-2xl font-semibold">{data?.avgMs != null ? `${data.avgMs} ms` : "—"}</div>
          <div className="mt-1 text-xs text-muted-foreground">Moyenne des derniers contrôles</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"><ServerCrash className="h-4 w-4" /> Erreurs 24h</div>
          <div className="mt-2 text-2xl font-semibold">{data?.erreurs24h ?? 0}</div>
          <div className="mt-1 text-xs text-muted-foreground">{data?.erreursCritiques24h ?? 0} critique(s)</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"><AlertTriangle className="h-4 w-4" /> Anomalies</div>
          <div className="mt-2 text-2xl font-semibold">{anomaliesTotal}</div>
          <div className="mt-1 text-xs text-muted-foreground">{anomalies.length} type(s) détecté(s)</div>
        </Card>
      </div>

      {/* Diagnostic IA */}
      <Card className="p-5">
        <h2 className="font-display text-lg">Diagnostic IA du jour</h2>
        {isLoading ? (
          <p className="mt-2 text-sm text-muted-foreground">Chargement…</p>
        ) : data?.diagnostic ? (
          <>
            <p className="mt-2 whitespace-pre-line text-sm">{data.diagnostic}</p>
            {problems.length > 0 && (
              <div className="mt-4 space-y-2">
                {problems.map((p: any, i: number) => (
                  <div key={i} className="rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <Badge className={GRAVITE_VARIANT[p.priorite] ?? GRAVITE_VARIANT.mineur} variant="outline">{p.priorite ?? "mineur"}</Badge>
                      <span className="text-sm font-medium">{p.titre}</span>
                    </div>
                    {p.cause && <p className="mt-1 text-xs text-muted-foreground"><strong>Cause probable :</strong> {p.cause}</p>}
                    {p.correction && <p className="mt-1 text-xs text-muted-foreground"><strong>Correction :</strong> {p.correction}</p>}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Aucun diagnostic disponible. Lancez une analyse pour en générer un.</p>
        )}
      </Card>

      {/* Suggestions */}
      <Card className="p-5">
        <h2 className="font-display text-lg">Suggestions d'amélioration</h2>
        {suggestions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Aucune suggestion pour le moment.</p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {suggestions.map((s: any) => (
              <div key={s.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium">{s.titre}</span>
                  <Badge className={GRAVITE_VARIANT[s.priorite] ?? GRAVITE_VARIANT.mineur} variant="outline">{s.priorite}</Badge>
                </div>
                {s.impact && <p className="mt-2 text-xs text-muted-foreground"><strong>Impact estimé :</strong> {s.impact}</p>}
                {s.action && <p className="mt-1 text-xs text-muted-foreground"><strong>Action :</strong> {s.action}</p>}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant={s.statut === "a_faire" ? "default" : "outline"}
                    onClick={() => suggestionMutation.mutate({ id: s.id, statut: "a_faire" })}>
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> À faire
                  </Button>
                  <Button size="sm" variant={s.statut === "ignoree" ? "secondary" : "ghost"}
                    onClick={() => suggestionMutation.mutate({ id: s.id, statut: "ignoree" })}>
                    Ignorer
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Anomalies de données */}
      <Card className="p-5">
        <h2 className="font-display text-lg">Anomalies de données</h2>
        {anomalies.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Aucune anomalie détectée aujourd'hui.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {anomalies.map((a: any) => (
              <div key={a.kind} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge className={GRAVITE_VARIANT[a.gravite] ?? GRAVITE_VARIANT.mineur} variant="outline">{a.gravite}</Badge>
                  <span className="truncate text-sm">{a.label}</span>
                </div>
                <span className="shrink-0 text-sm font-semibold">{a.count}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Graphique 30 jours */}
      <Card className="p-5">
        <h2 className="font-display text-lg">30 derniers jours</h2>
        <div className="mt-4 h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data?.serie ?? []}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={11} />
              <YAxis yAxisId="left" fontSize={11} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} fontSize={11} />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="erreurs" name="Erreurs" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="uptime" name="Disponibilité (%)" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Erreurs */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg">Erreurs détectées</h2>
          <div className="flex gap-2">
            <Select value={graviteFilter} onValueChange={setGraviteFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Gravité" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes gravités</SelectItem>
                <SelectItem value="critique">Critique</SelectItem>
                <SelectItem value="majeur">Majeur</SelectItem>
                <SelectItem value="mineur">Mineur</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statutFilter} onValueChange={setStatutFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Statut" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous statuts</SelectItem>
                <SelectItem value="nouveau">Nouveau</SelectItem>
                <SelectItem value="vu">Vu</SelectItem>
                <SelectItem value="resolu">Résolu</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {errors.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Aucune erreur pour ces filtres.</p>
        ) : (
          <div className="mt-3 divide-y rounded-md border">
            {errors.slice(0, 100).map((e: any) => (
              <button key={e.id} onClick={() => setDetail(e)}
                className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50">
                <Badge className={GRAVITE_VARIANT[e.gravite] ?? GRAVITE_VARIANT.mineur} variant="outline">{e.gravite}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{e.message}</div>
                  <div className="truncate text-xs text-muted-foreground">{e.type} · {e.url_page ?? "—"} · {fmt(e.created_at)}</div>
                </div>
                <Badge variant="secondary" className="shrink-0">{STATUT_LABEL[e.statut ?? "nouveau"]}</Badge>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="truncate">{detail?.message}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid gap-1 text-xs text-muted-foreground">
                <div><strong>Type :</strong> {detail.type}</div>
                <div><strong>Gravité :</strong> {detail.gravite}</div>
                <div><strong>Page :</strong> {detail.url_page ?? "—"}</div>
                <div><strong>Navigateur :</strong> {detail.navigateur ?? "—"}</div>
                <div><strong>Date :</strong> {fmt(detail.created_at)}</div>
              </div>
              {detail.stack && (
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed">{detail.stack}</pre>
              )}
              <div className="flex gap-2">
                <Button size="sm" variant="outline"
                  onClick={() => { errorMutation.mutate({ id: detail.id, statut: "vu" }); setDetail(null); }}>
                  Marquer comme vu
                </Button>
                <Button size="sm"
                  onClick={() => { errorMutation.mutate({ id: detail.id, statut: "resolu" }); setDetail(null); }}>
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Marquer comme résolu
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

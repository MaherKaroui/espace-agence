import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FolderOpen, CheckCircle2, Clock, AlertTriangle, MessageSquare, ShieldAlert, TrendingUp, RefreshCw } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { format, subDays } from "date-fns";
import { fr } from "date-fns/locale";
import { STATUTS } from "@/lib/labels";

export const Route = createFileRoute("/_authenticated/admin/direction")({
  head: () => ({ meta: [{ title: "Pilotage Direction" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const ok = roles?.some((r) => r.role === "admin" || r.role === "direction");
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: DirectionDashboard,
});

const COLORS = ["#0ea5e9", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

function DirectionDashboard() {
  const qc = useQueryClient();

  const { data: latest } = useQuery({
    queryKey: ["rapport-latest"],
    queryFn: async () => (await supabase.from("rapports_quotidiens").select("*").order("date_rapport", { ascending: false }).limit(1).maybeSingle()).data,
  });

  const { data: history = [] } = useQuery({
    queryKey: ["rapport-history"],
    queryFn: async () => {
      const since = format(subDays(new Date(), 14), "yyyy-MM-dd");
      const { data } = await supabase.from("rapports_quotidiens").select("*").gte("date_rapport", since).order("date_rapport", { ascending: true });
      return data ?? [];
    },
  });

  const { data: live } = useQuery({
    queryKey: ["direction-live"],
    queryFn: async () => {
      const [dos, tac, alerts] = await Promise.all([
        supabase.from("dossiers").select("id, statut, avancement, pole_id"),
        supabase.from("taches").select("id, statut, date_echeance").eq("statut", "en_cours"),
        supabase.from("audit_logs").select("id, severity, created_at").in("severity", ["warning", "critical"]).gte("created_at", subDays(new Date(), 1).toISOString()),
      ]);
      const dList = dos.data ?? [];
      return {
        actifs: dList.filter((d) => !["termine", "annule"].includes(d.statut)).length,
        termines: dList.filter((d) => d.statut === "termine").length,
        retard: (tac.data ?? []).filter((t) => t.date_echeance && new Date(t.date_echeance) < new Date()).length,
        alertes: alerts.data?.length ?? 0,
      };
    },
    refetchInterval: 30000,
  });

  const generate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("generer_rapport_quotidien", { _date: format(new Date(), "yyyy-MM-dd") });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Rapport généré"); qc.invalidateQueries(); },
    onError: (e: any) => toast.error(e.message),
  });

  const poleData = latest ? Object.entries(latest.repartition_pole || {}).map(([nom, cnt]) => ({ nom, cnt: cnt as number })) : [];
  const statutData = latest ? Object.entries(latest.repartition_statut || {}).map(([statut, cnt]) => ({
    statut: STATUTS.find((s) => s.value === statut)?.label ?? statut,
    cnt: cnt as number,
  })) : [];

  const trend = history.map((r: any) => ({
    date: format(new Date(r.date_rapport), "dd/MM", { locale: fr }),
    actifs: r.dossiers_actifs,
    termines: r.dossiers_termines,
    retard: r.taches_en_retard,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">Pilotage Direction</h1>
          <p className="text-muted-foreground mt-1">
            {latest ? `Dernier rapport : ${format(new Date(latest.date_rapport), "dd MMMM yyyy", { locale: fr })}` : "Aucun rapport pour l'instant"}
          </p>
        </div>
        <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
          <RefreshCw className={`h-4 w-4 mr-2 ${generate.isPending ? "animate-spin" : ""}`} />
          Générer le rapport du jour
        </Button>
      </div>

      {/* KPI temps réel */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Dossiers actifs" value={live?.actifs ?? 0} icon={FolderOpen} />
        <Kpi label="Dossiers terminés" value={live?.termines ?? 0} icon={CheckCircle2} tone="success" />
        <Kpi label="Tâches en retard" value={live?.retard ?? 0} icon={Clock} tone="warning" />
        <Kpi label="Alertes 24h" value={live?.alertes ?? 0} icon={ShieldAlert} tone="danger" />
      </div>

      {latest && (
        <>
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-6">
              <h2 className="font-display text-lg mb-4">Dossiers par pôle</h2>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={poleData}>
                  <XAxis dataKey="nom" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="cnt" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-6">
              <h2 className="font-display text-lg mb-4">Répartition par statut</h2>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={statutData} dataKey="cnt" nameKey="statut" cx="50%" cy="50%" outerRadius={80} label>
                    {statutData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card className="p-6">
            <h2 className="font-display text-lg mb-4">Tendance (14 derniers jours)</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trend}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="actifs" fill="#0ea5e9" name="Actifs" />
                <Bar dataKey="termines" fill="#10b981" name="Terminés" />
                <Bar dataKey="retard" fill="#ef4444" name="Tâches en retard" />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6">
            <h2 className="font-display text-lg mb-4">Synthèse du jour</h2>
            <div className="grid md:grid-cols-3 gap-4 text-sm">
              <SynthRow icon={FolderOpen} label="Nouveaux dossiers" value={latest.dossiers_nouveaux} />
              <SynthRow icon={Clock} label="En attente client" value={latest.dossiers_en_attente_client} />
              <SynthRow icon={CheckCircle2} label="Tâches terminées (24h)" value={latest.taches_terminees_24h} />
              <SynthRow icon={AlertTriangle} label="Tâches en retard" value={latest.taches_en_retard} tone="warning" />
              <SynthRow icon={MessageSquare} label="Messages (24h)" value={latest.messages_24h} />
              <SynthRow icon={ShieldAlert} label="Alertes sécurité (24h)" value={latest.alertes_securite_24h} tone="danger" />
            </div>
            <div className="mt-6 pt-6 border-t">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Avancement moyen des dossiers actifs</span>
                <span className="text-sm font-display">{latest.avancement_moyen}%</span>
              </div>
              <Progress value={Number(latest.avancement_moyen)} />
            </div>
          </Card>
        </>
      )}

      <Card className="p-6">
        <h2 className="font-display text-lg mb-4">Rapports archivés</h2>
        <div className="divide-y">
          {history.slice().reverse().map((r: any) => (
            <div key={r.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm">
                <div className="font-medium">{format(new Date(r.date_rapport), "EEEE dd MMMM yyyy", { locale: fr })}</div>
                <div className="text-xs text-muted-foreground">
                  {r.dossiers_actifs} actifs · {r.taches_en_retard} en retard · {r.alertes_securite_24h} alertes
                </div>
              </div>
              <div className="flex gap-2">
                <span className="text-xs text-muted-foreground">Avancement {r.avancement_moyen}%</span>
              </div>
            </div>
          ))}
          {history.length === 0 && <div className="py-6 text-sm text-muted-foreground text-center">Aucun rapport archivé.</div>}
        </div>
        <div className="mt-4">
          <Link to="/admin/audit" className="text-sm text-primary hover:underline">Voir le journal d'audit complet →</Link>
        </div>
      </Card>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone = "default" }: any) {
  const tones: Record<string, string> = {
    default: "text-primary bg-primary/10",
    success: "text-success-foreground bg-success/20",
    warning: "text-warning-foreground bg-warning/20",
    danger: "text-destructive bg-destructive/10",
  };
  return (
    <Card className="p-4">
      <div className={`h-9 w-9 rounded-lg ${tones[tone]} flex items-center justify-center mb-3`}><Icon className="h-4 w-4" /></div>
      <div className="text-2xl font-display font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </Card>
  );
}

function SynthRow({ icon: Icon, label, value, tone = "default" }: any) {
  const tones: Record<string, string> = {
    default: "text-muted-foreground",
    warning: "text-warning-foreground",
    danger: "text-destructive",
  };
  return (
    <div className="flex items-center gap-3">
      <Icon className={`h-4 w-4 ${tones[tone]}`} />
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="font-display text-xl">{value}</div>
      </div>
    </div>
  );
}

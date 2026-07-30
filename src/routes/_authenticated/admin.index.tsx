import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Users, FolderOpen, FileText, Clock, ListChecks, AlertTriangle, CalendarCheck, CheckCircle2, Ban, MessageSquareOff, FileSearch, CalendarX, Zap } from "lucide-react";
import { AgencyTasksPriorityBoard } from "@/components/agency-tasks-priority-board";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Admin — Dashboard" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const ok = roles?.some((r) => ["admin","direction","manager","consultant"].includes(r.role));
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: AdminDashboard,
});

function AdminDashboard() {
  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const [clients, dossiers, documents, messages] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("dossiers").select("statut"),
        supabase.from("documents").select("id", { count: "exact", head: true }),
        supabase.from("messages").select("id", { count: "exact", head: true }),
      ]);
      const dList = dossiers.data ?? [];
      return {
        clients: clients.count ?? 0,
        dossiers: dList.length,
        documents: documents.count ?? 0,
        messages: messages.count ?? 0,
        enAttente: dList.filter((d) => ["en_attente", "documents_manquants", "a_completer"].includes(d.statut)).length,
        valides: dList.filter((d) => ["valide", "termine"].includes(d.statut)).length,
      };
    },
  });

  const { data: taskKpis } = useQuery({
    queryKey: ["agency-tasks-kpis"],
    queryFn: async () => {
      const { data } = await supabase
        .from("agency_tasks")
        .select("id, status, priority, due_date, completed_at, archived_at")
        .is("archived_at", null);
      const rows = data ?? [];
      const now = new Date();
      const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
      const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      const open = rows.filter((r) => r.status !== "terminee");
      return {
        today: open.filter((r) => r.due_date && new Date(r.due_date) <= endOfDay && new Date(r.due_date) >= new Date(new Date().setHours(0,0,0,0))).length,
        urgent: open.filter((r) => r.priority === "urgente").length,
        overdue: open.filter((r) => r.due_date && new Date(r.due_date) < now).length,
        doneWeek: rows.filter((r) => r.status === "terminee" && r.completed_at && new Date(r.completed_at) >= weekAgo).length,
      };
    },
  });

  const BLOCKED_DAYS = 7;
  const UNREAD_DAYS = 3;

  const { data: actionable } = useQuery({
    queryKey: ["admin-actionable-kpis"],
    queryFn: async () => {
      const now = new Date();
      const blockedSince = new Date(Date.now() - BLOCKED_DAYS * 24 * 3600 * 1000).toISOString();
      const unreadSince = new Date(Date.now() - UNREAD_DAYS * 24 * 3600 * 1000).toISOString();
      const openStatuts = ["en_attente", "documents_manquants", "a_completer", "en_cours_etude", "en_cours_traitement"] as const;

      const [dossiersBloques, msgsSansReponse, docsAVerifier, rdvExpires] = await Promise.all([
        supabase
          .from("dossiers")
          .select("id", { count: "exact", head: true })
          .in("statut", openStatuts)
          .lt("updated_at", blockedSince),
        supabase
          .from("messages")
          .select("client_id")
          .eq("from_agence", true)
          .is("read_at", null)
          .lt("created_at", unreadSince),
        supabase
          .from("documents")
          .select("id", { count: "exact", head: true })
          .eq("statut", "en_attente")
          .eq("from_agence", false),
        supabase
          .from("rendez_vous")
          .select("id", { count: "exact", head: true })
          .eq("status", "en_attente")
          .lt("starts_at", now.toISOString()),
      ]);

      const uniqClients = new Set((msgsSansReponse.data ?? []).map((m: any) => m.client_id));

      return {
        dossiersBloques: dossiersBloques.count ?? 0,
        clientsSansReponse: uniqClients.size,
        docsAVerifier: docsAVerifier.count ?? 0,
        rdvExpires: rdvExpires.count ?? 0,
      };
    },
  });

  const { data: healthKpis } = useQuery({
    queryKey: ["admin-dossier-health-kpis"],
    queryFn: async () => {
      const { data: dossiers } = await supabase
        .from("dossiers")
        .select("id, categorie, statut, avancement, updated_at, archived_at")
        .is("archived_at", null);
      const list = dossiers ?? [];
      const ids = list.map((d) => d.id);
      if (ids.length === 0) {
        return { incoherents: 0, pretsAFinaliser: 0, docsAVerifier: 0, docsManquants: 0, autoEnRetard: 0 };
      }
      const [docsRes, tachesRes, tasksRes] = await Promise.all([
        supabase.from("documents").select("id, dossier_id, nom, detected_type, statut").in("dossier_id", ids),
        supabase.from("taches").select("id, dossier_id, statut").in("dossier_id", ids),
        supabase.from("agency_tasks")
          .select("id, dossier_id, status, priority, due_date, auto")
          .in("dossier_id", ids).is("archived_at", null),
      ]);
      const docsBy: Record<string, any[]> = {};
      for (const d of docsRes.data ?? []) (docsBy[d.dossier_id] ??= []).push(d);
      const tachesBy: Record<string, any[]> = {};
      for (const t of tachesRes.data ?? []) (tachesBy[t.dossier_id] ??= []).push(t);
      const taskBy: Record<string, any> = {};
      for (const t of tasksRes.data ?? []) if (t.dossier_id && !taskBy[t.dossier_id]) taskBy[t.dossier_id] = t;

      let incoherents = 0, pretsAFinaliser = 0, docsAVerifier = 0, docsManquants = 0, autoEnRetard = 0;
      for (const d of list) {
        const h = computeDossierHealth({
          dossier: d as any,
          documents: docsBy[d.id] ?? [],
          taches: tachesBy[d.id] ?? [],
          linkedTask: taskBy[d.id] ?? null,
        });
        if (h.anomalies.some((a) => ["manual_mismatch", "zero_but_validated", "full_but_missing", "steps_done_low_progress"].includes(a.key))) incoherents++;
        if (!h.isDone && h.docs.total > 0 && h.docs.validated === h.docs.total) pretsAFinaliser++;
        if (h.docs.toReview > 0) docsAVerifier++;
        if (h.docs.missing > 0) docsManquants++;
        if (h.taskOverdue && taskBy[d.id]?.auto) autoEnRetard++;
      }
      return { incoherents, pretsAFinaliser, docsAVerifier, docsManquants, autoEnRetard };
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl">Tableau de bord agence</h1>
        <p className="text-muted-foreground mt-1">Vue d'ensemble de la plateforme.</p>
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <Zap className="h-5 w-5 text-red-600" />
          <h2 className="font-display text-xl">À traiter en priorité</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">Signaux actionnables — cliquez pour ouvrir la liste filtrée.</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label={`Dossiers bloqués (>${BLOCKED_DAYS}j)`} value={actionable?.dossiersBloques ?? 0} icon={Ban} tone="danger" to="/admin/dossiers" />
          <StatCard label={`Clients sans réponse (>${UNREAD_DAYS}j)`} value={actionable?.clientsSansReponse ?? 0} icon={MessageSquareOff} tone="warning" to="/admin/messages" />
          <StatCard label="Documents à vérifier" value={healthKpis?.docsAVerifier ?? actionable?.docsAVerifier ?? 0} icon={FileSearch} tone="info" to="/admin/dossiers" />
          <StatCard label="RDV expirés (en attente)" value={actionable?.rdvExpires ?? 0} icon={CalendarX} tone="danger" to="/admin/rendez-vous" />
          <StatCard label="Avancement incohérent" value={healthKpis?.incoherents ?? 0} icon={AlertTriangle} tone="warning" to="/admin/dossiers" />
          <StatCard label="Prêts à finaliser" value={healthKpis?.pretsAFinaliser ?? 0} icon={CheckCircle2} tone="success" to="/admin/dossiers" />
          <StatCard label="Documents manquants" value={healthKpis?.docsManquants ?? 0} icon={FileText} tone="warning" to="/admin/dossiers" />
          <StatCard label="Tâches auto en retard" value={healthKpis?.autoEnRetard ?? 0} icon={ListChecks} tone="danger" to="/admin/taches-agence" />
        </div>
      </div>


      <div>
        <h2 className="font-display text-xl mb-3">Dossiers clients</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Clients" value={stats?.clients ?? 0} icon={Users} />
          <StatCard label="Dossiers ouverts" value={stats?.dossiers ?? 0} icon={FolderOpen} />
          <StatCard label="Documents" value={stats?.documents ?? 0} icon={FileText} />
          <StatCard label="Dossiers en attente" value={stats?.enAttente ?? 0} icon={Clock} tone="warning" />
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-gold" />
          <h2 className="font-display text-xl">Tâches internes de l'agence</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">Todos d'équipe — indépendants des dossiers clients.</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Aujourd'hui" value={taskKpis?.today ?? 0} icon={CalendarCheck} />
          <StatCard label="Urgentes" value={taskKpis?.urgent ?? 0} icon={AlertTriangle} tone="danger" />
          <StatCard label="En retard" value={taskKpis?.overdue ?? 0} icon={Clock} tone="warning" />
          <StatCard label="Terminées 7 j." value={taskKpis?.doneWeek ?? 0} icon={CheckCircle2} tone="success" />
        </div>
      </div>

      <AgencyTasksPriorityBoard />

      <div className="grid md:grid-cols-2 gap-4">
        <Link to="/admin/clients"><Card className="p-6 hover:border-primary/40 transition"><div className="font-display text-lg">Gérer les clients →</div><p className="text-sm text-muted-foreground mt-1">Rechercher, consulter, contacter.</p></Card></Link>
        <Link to="/admin/dossiers"><Card className="p-6 hover:border-primary/40 transition"><div className="font-display text-lg">Tous les dossiers →</div><p className="text-sm text-muted-foreground mt-1">Suivre, modifier les statuts, valider.</p></Card></Link>
      </div>
    </div>
  );
}


function StatCard({ label, value, icon: Icon, tone = "default", to }: { label: string; value: number; icon: any; tone?: string; to?: string }) {
  const colors: Record<string, string> = {
    default: "text-primary bg-primary/10",
    warning: "text-warning-foreground bg-warning/20",
    info: "text-info bg-info/10",
    danger: "text-red-600 bg-red-500/10",
    success: "text-emerald-700 bg-emerald-500/10",
  };
  const inner = (
    <Card className={`p-4 ${to ? "hover:border-primary/40 transition cursor-pointer" : ""}`}>
      <div className={`h-9 w-9 rounded-lg ${colors[tone]} flex items-center justify-center mb-3`}><Icon className="h-4 w-4" /></div>
      <div className="text-2xl font-display font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </Card>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

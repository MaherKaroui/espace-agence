import { useState, useMemo } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FolderOpen, CheckCircle2, Clock, AlertTriangle, MessageSquare, ShieldAlert,
  RefreshCw, Users, FileText, Bell, Eye, Download, FileDown, ArrowUpRight,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { format, subDays } from "date-fns";
import { fr } from "date-fns/locale";
import { roleLabelFr } from "@/lib/role-labels";
import {
  generateDailyDirectionReport,
  getDirectionReport,
  listDirectionReports,
  getUserActivityDetail,
  getMessagesForDay,
} from "@/lib/direction-report.functions";

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


function fmtHour(ts?: string | null) {
  return ts ? format(new Date(ts), "HH:mm") : "—";
}

const ACTION_LABELS: Record<string, string> = {
  "message.sent": "Message client envoyé",
  "message.flagged": "Message signalé",
  "message.edited": "Message modifié",
  "message.deleted": "Message supprimé",
  "internal_message.sent": "Message interne envoyé",
  "group_message.sent": "Message de groupe envoyé",
  "document.uploaded": "Document déposé",
  "document.validated": "Document validé",
  "document.rejected": "Document refusé",
  "document.status_changed": "Statut document modifié",
  "document.downloaded": "Document téléchargé",
  "dossier.created": "Dossier créé",
  "dossier.updated": "Dossier modifié",
  "dossier.status_changed": "Statut dossier modifié",
  "client_note.added": "Note interne ajoutée",
  "relance.sent": "Relance envoyée",
  "rendezvous.created": "Rendez-vous créé",
  "rendezvous.updated": "Rendez-vous modifié",
  "client.archived": "Client archivé",
  "client.unarchived": "Client réactivé",
  "rgpd.auto_purge": "Purge RGPD automatique",
  "rgpd.account_anonymized": "Compte anonymisé",
};
const actionLabel = (a: string) => ACTION_LABELS[a] ?? a;

function DirectionDashboard() {
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const [selectedDate, setSelectedDate] = useState(today);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [messageFilter, setMessageFilter] = useState<"all" | "client" | "internal" | "group">("all");

  const generateFn = useServerFn(generateDailyDirectionReport);
  const getReportFn = useServerFn(getDirectionReport);
  const listReportsFn = useServerFn(listDirectionReports);
  const getUserDetailFn = useServerFn(getUserActivityDetail);
  const getMessagesFn = useServerFn(getMessagesForDay);

  // Live KPIs (temps réel du jour)
  const { data: live } = useQuery({
    queryKey: ["direction-live"],
    queryFn: async () => {
      const [dos, tac, alerts] = await Promise.all([
        supabase.from("dossiers").select("id, statut"),
        supabase.from("taches").select("id, statut, date_echeance").eq("statut", "en_cours"),
        supabase.from("audit_logs").select("id, severity")
          .in("severity", ["warning", "critical"])
          .gte("created_at", subDays(new Date(), 1).toISOString()),
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

  // Rapport de la date sélectionnée
  const { data: report, isFetching: reportLoading } = useQuery({
    queryKey: ["direction-report", selectedDate],
    queryFn: () => getReportFn({ data: { date: selectedDate } }),
  });

  const { data: archived = [] } = useQuery({
    queryKey: ["direction-archived"],
    queryFn: () => listReportsFn(),
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["direction-messages", selectedDate, messageFilter],
    queryFn: () => getMessagesFn({ data: { date: selectedDate, type: messageFilter } }),
  });

  const generate = useMutation({
    mutationFn: async () => generateFn({ data: { date: selectedDate } }),
    onSuccess: () => {
      toast.success("Rapport généré");
      qc.invalidateQueries({ queryKey: ["direction-report"] });
      qc.invalidateQueries({ queryKey: ["direction-archived"] });
      qc.invalidateQueries({ queryKey: ["direction-messages"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const summary = (report?.summary_json ?? {}) as any;
  const users = (report?.user_reports_json ?? []) as any[];
  const poleData = (report?.pole_reports_json ?? []) as any[];
  const clientTop = (report?.client_reports_json ?? []) as any[];
  const hourly = (report?.hourly_activity_json ?? []) as any[];
  const hourlyChart = useMemo(() => {
    const h = new Array(24).fill(0).map((_, i) => ({ hour: `${i}h`, actions: 0 }));
    for (const row of hourly) if (row.hour != null) h[row.hour].actions = row.actions;
    return h;
  }, [hourly]);

  const staffChart = useMemo(
    () =>
      users
        .filter((u) => u.roles && u.roles.some((r: string) => r !== "client"))
        .slice(0, 10)
        .map((u) => ({ name: u.name?.slice(0, 20) ?? "?", actions: u.actions })),
    [users],
  );

  const exportCSV = () => {
    if (!report) return;
    const rows = [
      ["Nom", "Rôles", "Pôles", "Première activité", "Dernière activité", "Actions", "Messages client", "Msg internes", "Msg groupe", "Docs déposés", "Docs validés", "Docs refusés", "Dossiers modifiés", "Relances", "Notes"],
      ...users.map((u) => [
        u.name, (u.roles ?? []).join("+"), (u.poles ?? []).join("+"),
        fmtHour(u.first_action), fmtHour(u.last_action),
        u.actions, u.messages, u.internal_messages, u.group_messages,
        u.documents_uploaded, u.documents_validated, u.documents_rejected,
        u.dossiers_modifies, u.relances, u.notes,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rapport-direction-${selectedDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = async () => {
    if (!report) return;
    const { default: jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`Rapport Direction — ${format(new Date(selectedDate), "EEEE dd MMMM yyyy", { locale: fr })}`, 14, 15);
    doc.setFontSize(10);
    doc.text(
      `Actions: ${summary.actions ?? 0} · Messages: ${summary.messages ?? 0} · Documents: ${summary.documents ?? 0} · Dossiers: ${summary.dossiers_modifies ?? 0} · Utilisateurs actifs: ${summary.active_users ?? 0}`,
      14, 24,
    );
    autoTable(doc, {
      startY: 30,
      head: [["Utilisateur", "Rôle", "1re act.", "Dern.", "Actions", "Msg", "Docs", "Doss.", "Relances"]],
      body: users.map((u) => [
        u.name, (u.roles ?? []).map(roleLabelFr).join(", "),
        fmtHour(u.first_action), fmtHour(u.last_action),
        u.actions, u.messages + u.internal_messages + u.group_messages,
        u.documents_uploaded, u.dossiers_modifies, u.relances,
      ]),
      styles: { fontSize: 8 },
    });
    doc.save(`rapport-direction-${selectedDate}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">Pilotage Direction</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Vue complète et détaillée de l'activité — messages, documents, dossiers, alertes.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-[170px]"
          />
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${generate.isPending ? "animate-spin" : ""}`} />
            Générer le rapport
          </Button>
          {report && (
            <>
              <Button variant="outline" onClick={exportCSV}><Download className="h-4 w-4 mr-2" />CSV</Button>
              <Button variant="outline" onClick={exportPDF}><FileDown className="h-4 w-4 mr-2" />PDF</Button>
            </>
          )}
        </div>
      </div>

      {/* KPIs — mix temps réel + rapport */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="Actions du jour" value={summary.actions ?? 0} icon={ArrowUpRight} />
        <Kpi label="Messages" value={summary.messages ?? 0} icon={MessageSquare} />
        <Kpi label="Documents" value={summary.documents ?? 0} icon={FileText} />
        <Kpi label="Dossiers modifiés" value={summary.dossiers_modifies ?? 0} icon={FolderOpen} />
        <Kpi label="Relances" value={summary.relances ?? 0} icon={Bell} />
        <Kpi label="Clients actifs" value={summary.clients_actifs ?? 0} icon={Users} tone="success" />
        <Kpi label="Staff actif" value={summary.staff_actif ?? 0} icon={Users} tone="success" />
        <Kpi label="Tâches en retard" value={live?.retard ?? summary.taches_en_retard ?? 0} icon={Clock} tone="warning" />
        <Kpi label="Alertes 24h" value={live?.alertes ?? summary.alertes ?? 0} icon={ShieldAlert} tone="danger" />
        <Kpi label="Dossiers actifs" value={live?.actifs ?? 0} icon={FolderOpen} />
      </div>

      {!report && !reportLoading && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Aucun rapport pour cette date. Cliquez sur <span className="font-medium">« Générer le rapport »</span> pour agréger l'activité.
        </Card>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Vue du jour</TabsTrigger>
          <TabsTrigger value="users">Rapport par personne</TabsTrigger>
          <TabsTrigger value="messages">Messages du jour</TabsTrigger>
          <TabsTrigger value="archives">Rapports archivés</TabsTrigger>
        </TabsList>

        {/* -------- Overview -------- */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-6">
              <h2 className="font-display text-lg mb-4">Activité par heure</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={hourlyChart}>
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="actions" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-6">
              <h2 className="font-display text-lg mb-4">Top 10 collaborateurs</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={staffChart} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="actions" fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-6">
              <h2 className="font-display text-lg mb-4">Actions par pôle</h2>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={poleData.filter((p) => p.actions > 0)} dataKey="actions" nameKey="nom" cx="50%" cy="50%" outerRadius={80} label>
                    {poleData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-6">
              <h2 className="font-display text-lg mb-4">Top clients actifs</h2>
              <div className="space-y-2 max-h-[240px] overflow-auto">
                {clientTop.length === 0 && <div className="text-sm text-muted-foreground">Aucune activité client.</div>}
                {clientTop.map((c) => (
                  <div key={c.client_id} className="flex items-center justify-between text-sm border-b pb-2">
                    <span>{c.name}</span>
                    <Badge variant="secondary">{c.actions} action{c.actions > 1 ? "s" : ""}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* -------- Par personne -------- */}
        <TabsContent value="users" className="space-y-4">
          <Card className="p-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Personne</TableHead>
                  <TableHead>Rôles / Pôles</TableHead>
                  <TableHead>1re</TableHead>
                  <TableHead>Dernière</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                  <TableHead className="text-right">Documents</TableHead>
                  <TableHead className="text-right">Dossiers</TableHead>
                  <TableHead className="text-right">Relances</TableHead>
                  <TableHead className="text-right">Notes</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-6">
                      Aucune activité pour cette date. Générez le rapport si besoin.
                    </TableCell>
                  </TableRow>
                )}
                {users.map((u) => (
                  <TableRow key={u.user_id}>
                    <TableCell>
                      <div className="font-medium">{u.name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(u.roles ?? []).map((r: string) => (
                          <Badge key={r} variant="outline" className="text-[10px]">{roleLabelFr(r)}</Badge>
                        ))}
                      </div>
                      {u.poles && u.poles.length > 0 && (
                        <div className="text-[11px] text-muted-foreground mt-1">{u.poles.join(", ")}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{fmtHour(u.first_action)}</TableCell>
                    <TableCell className="text-xs">{fmtHour(u.last_action)}</TableCell>
                    <TableCell className="text-right font-medium">{u.actions}</TableCell>
                    <TableCell className="text-right">{u.messages + u.internal_messages + u.group_messages}</TableCell>
                    <TableCell className="text-right">{u.documents_uploaded}</TableCell>
                    <TableCell className="text-right">{u.dossiers_modifies}</TableCell>
                    <TableCell className="text-right">{u.relances}</TableCell>
                    <TableCell className="text-right">{u.notes}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setDetailUserId(u.user_id)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* -------- Messages -------- */}
        <TabsContent value="messages" className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Type :</span>
            <Select value={messageFilter} onValueChange={(v: any) => setMessageFilter(v)}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="client">Messages client</SelectItem>
                <SelectItem value="internal">Messages internes</SelectItem>
                <SelectItem value="group">Messages de groupe</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-auto">{messages.length} message{messages.length > 1 ? "s" : ""}</span>
          </div>

          <Card className="p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-8">
                Aucun message pour cette date.
              </div>
            )}
            {messages.map((m: any) => {
              const senderName = m.sender ? `${m.sender.prenom ?? ""} ${m.sender.nom ?? ""}`.trim() || m.sender.email : "—";
              const target =
                m.type === "client"
                  ? (m.from_agence
                      ? `→ Client ${m.client ? `${m.client.prenom ?? ""} ${m.client.nom ?? ""}`.trim() : ""}`
                      : `← De ${m.client ? `${m.client.prenom ?? ""} ${m.client.nom ?? ""}`.trim() : "client"}`)
                  : m.type === "internal"
                  ? `Conversation interne`
                  : `Conversation de groupe`;
              return (
                <div key={`${m.type}-${m.id}`} className="border-b last:border-b-0 pb-3 last:pb-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Badge variant="outline" className="text-[10px]">{
                      m.type === "client" ? "Client" : m.type === "internal" ? "Interne" : "Groupe"
                    }</Badge>
                    <span className="font-medium text-foreground">{senderName}</span>
                    <span>{target}</span>
                    <span className="ml-auto">{format(new Date(m.created_at), "HH:mm")}</span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap">
                    {m.content || <span className="text-muted-foreground italic">— sans texte —</span>}
                  </div>
                  {m.attachment_name && (
                    <div className="text-xs text-muted-foreground mt-1">📎 {m.attachment_name}</div>
                  )}
                </div>
              );
            })}
          </Card>
        </TabsContent>

        {/* -------- Archives -------- */}
        <TabsContent value="archives" className="space-y-2">
          <Card className="p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                  <TableHead className="text-right">Personnes actives</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                  <TableHead className="text-right">Documents</TableHead>
                  <TableHead className="text-right">Dossiers</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {archived.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                      Aucun rapport archivé.
                    </TableCell>
                  </TableRow>
                )}
                {archived.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {format(new Date(r.report_date), "EEEE dd MMMM yyyy", { locale: fr })}
                    </TableCell>
                    <TableCell className="text-right">{r.actions_count}</TableCell>
                    <TableCell className="text-right">{r.active_users_count}</TableCell>
                    <TableCell className="text-right">{r.messages_count}</TableCell>
                    <TableCell className="text-right">{r.documents_count}</TableCell>
                    <TableCell className="text-right">{r.dossiers_modified_count}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setSelectedDate(r.report_date)}>
                        <Eye className="h-4 w-4 mr-1" />Voir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {report && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Utilisateurs actifs ce jour</span>
            <span className="text-sm font-display">{summary.active_users ?? 0}</span>
          </div>
          <Progress value={Math.min(100, ((summary.active_users ?? 0) / Math.max(1, (summary.active_users ?? 0) + 10)) * 100)} />
        </Card>
      )}

      {/* Detail dialog */}
      <UserDetailDialog
        userId={detailUserId}
        date={selectedDate}
        onClose={() => setDetailUserId(null)}
        fetcher={getUserDetailFn}
        userMeta={users.find((u) => u.user_id === detailUserId)}
      />
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone = "default" }: any) {
  const tones: Record<string, string> = {
    default: "text-primary bg-primary/10",
    success: "text-emerald-700 bg-emerald-100",
    warning: "text-amber-700 bg-amber-100",
    danger: "text-destructive bg-destructive/10",
  };
  return (
    <Card className="p-3">
      <div className={`h-8 w-8 rounded-lg ${tones[tone]} flex items-center justify-center mb-2`}><Icon className="h-4 w-4" /></div>
      <div className="text-xl font-display font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
    </Card>
  );
}

function UserDetailDialog({
  userId, date, onClose, fetcher, userMeta,
}: {
  userId: string | null;
  date: string;
  onClose: () => void;
  fetcher: ReturnType<typeof useServerFn<typeof getUserActivityDetail>>;
  userMeta?: any;
}) {
  const { data: timeline = [], isFetching } = useQuery({
    queryKey: ["user-detail", userId, date],
    enabled: !!userId,
    queryFn: () => fetcher({ data: { userId: userId!, date } }),
  });

  return (
    <Dialog open={!!userId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {userMeta?.name ?? "Détail utilisateur"}
            <span className="text-xs text-muted-foreground font-normal ml-2">
              {format(new Date(date), "dd MMMM yyyy", { locale: fr })}
            </span>
          </DialogTitle>
        </DialogHeader>

        {userMeta && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs border-b pb-3">
            <Stat label="Actions" value={userMeta.actions} />
            <Stat label="Messages" value={userMeta.messages + userMeta.internal_messages + userMeta.group_messages} />
            <Stat label="Documents" value={userMeta.documents_uploaded} />
            <Stat label="Dossiers modifiés" value={userMeta.dossiers_modifies} />
            <Stat label="Relances" value={userMeta.relances} />
            <Stat label="Notes" value={userMeta.notes} />
            <Stat label="1re activité" value={fmtHour(userMeta.first_action)} />
            <Stat label="Dernière activité" value={fmtHour(userMeta.last_action)} />
          </div>
        )}

        {isFetching && <div className="text-sm text-muted-foreground py-4">Chargement…</div>}

        <div className="relative border-l-2 border-muted pl-4 space-y-4 mt-3">
          {timeline.length === 0 && !isFetching && (
            <div className="text-sm text-muted-foreground">Aucun événement enregistré.</div>
          )}
          {timeline.map((e: any) => (
            <div key={e.id} className="relative">
              <div className="absolute -left-[21px] top-1 h-3 w-3 rounded-full bg-primary" />
              <div className="text-xs text-muted-foreground">
                {format(new Date(e.created_at), "HH:mm:ss")}
                {e.severity !== "info" && (
                  <Badge variant={e.severity === "critical" ? "destructive" : "outline"} className="ml-2 text-[10px]">
                    {e.severity}
                  </Badge>
                )}
              </div>
              <div className="text-sm font-medium">{actionLabel(e.action)}</div>
              <div className="text-xs text-muted-foreground space-y-0.5 mt-0.5">
                {e.dossier && <div>Dossier : <span className="text-foreground">{e.dossier.titre}</span></div>}
                {e.related_dossier && !e.dossier && <div>Dossier : <span className="text-foreground">{e.related_dossier.titre}</span></div>}
                {e.related_client && (
                  <div>Client : <span className="text-foreground">{`${e.related_client.prenom ?? ""} ${e.related_client.nom ?? ""}`.trim() || e.related_client.email}</span></div>
                )}
                {e.document && <div>Document : <span className="text-foreground">{e.document.nom}</span></div>}
                {e.message?.content && (
                  <div className="mt-1 rounded bg-muted p-2 text-foreground whitespace-pre-wrap">
                    « {e.message.content} »
                  </div>
                )}
                {e.internal_message?.content && (
                  <div className="mt-1 rounded bg-muted p-2 text-foreground whitespace-pre-wrap">
                    « {e.internal_message.content} »
                  </div>
                )}
                {e.group_message?.content && (
                  <div className="mt-1 rounded bg-muted p-2 text-foreground whitespace-pre-wrap">
                    « {e.group_message.content} »
                  </div>
                )}
                {e.metadata?.reasons && (
                  <div className="text-amber-700">
                    Motifs : {(e.metadata.reasons as string[]).join(", ")}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-display text-base">{value}</div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, FileDown, Mail, Send, AlertTriangle, CheckCircle2, Clock, CalendarClock, Loader2, RefreshCw } from "lucide-react";
import { format, startOfDay, endOfDay, subDays, startOfWeek, startOfMonth } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { roleLabelFr } from "@/lib/role-labels";
import { getActivityReports } from "@/lib/activity-reports.functions";
import { previewEmailTemplate } from "@/lib/preview-email.functions";
import { sendActivityReportNow, listArchivedDigests, getArchivedDigestUrl, regenerateArchivedDigest } from "@/lib/daily-report.functions";

export const Route = createFileRoute("/_authenticated/admin/rapports-activite")({
  head: () => ({
    meta: [
      { title: "Rapports d'activité — IZISuivis" },
      { name: "description", content: "Rapports d'activité de l'équipe : tâches terminées, en cours, en retard et points d'attention." },
      { property: "og:title", content: "Rapports d'activité — IZISuivis" },
      { property: "og:description", content: "Suivi de l'activité de chaque membre de l'équipe sur la période choisie." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const ok = roles?.some((r) => ["admin", "direction"].includes(r.role));
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: RapportsActivite,
});

function ArchivedDigests() {
  const listFn = useServerFn(listArchivedDigests);
  const urlFn = useServerFn(getArchivedDigestUrl);
  const regenFn = useServerFn(regenerateArchivedDigest);
  const [opening, setOpening] = useState<string | null>(null);
  const [regen, setRegen] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["archived-digests"],
    queryFn: () => listFn({}),
  });

  async function open(path: string) {
    setOpening(path);
    try {
      const res: any = await urlFn({ data: { path } });
      if (res?.url) window.open(res.url, "_blank", "noopener");
      else toast.error("Lien indisponible");
    } catch (e: any) {
      toast.error(e?.message ?? "Téléchargement impossible");
    } finally {
      setOpening(null);
    }
  }

  async function regenerate(date: string) {
    setRegen(date);
    try {
      const res: any = await regenFn({ data: { date } });
      if (res?.ok) toast.success("PDF regénéré avec la mise en page actuelle");
      else toast.error("Régénération impossible");
    } catch (e: any) {
      toast.error(e?.message ?? "Régénération impossible");
    } finally {
      setRegen(null);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h2 className="font-display text-lg">Comptes rendus archivés</h2>
        <p className="text-muted-foreground text-sm">
          PDF des 90 derniers jours. Les fichiers générés avant la refonte gardent l'ancienne
          mise en page : utilisez « Regénérer » pour les reconstruire au format condensé.
        </p>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-muted-foreground text-sm">Aucun compte rendu archivé pour le moment.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {data.map((f: any) => (
            <li key={f.path} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="text-sm">
                {format(new Date(f.date), "EEEE d MMMM yyyy", { locale: fr })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={regen === f.date}
                  onClick={() => regenerate(f.date)}
                >
                  {regen === f.date ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Regénérer
                </Button>
                <Button size="sm" variant="outline" disabled={opening === f.path} onClick={() => open(f.path)}>
                  {opening === f.path ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileDown className="h-4 w-4 mr-2" />
                  )}
                  Télécharger
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}


type PeriodKey = "today" | "yesterday" | "week" | "month" | "custom";

const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Aujourd'hui",
  yesterday: "Hier",
  week: "Cette semaine",
  month: "Ce mois",
  custom: "Personnalisée",
};

const PRIORITY_LABELS: Record<string, string> = { basse: "Basse", normale: "Normale", haute: "Haute", urgente: "Urgente" };
const STATUS_LABELS: Record<string, string> = { a_faire: "À faire", en_cours: "En cours", en_attente: "En attente", bloquee: "Bloquée", terminee: "Terminée" };

function fmt(d?: string | null) {
  return d ? format(new Date(d), "dd/MM/yyyy HH:mm", { locale: fr }) : "—";
}

function RapportsActivite() {
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [customFrom, setCustomFrom] = useState(format(new Date(), "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [emailPreview, setEmailPreview] = useState<{ html: string; subject: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const range = useMemo(() => {
    const now = new Date();
    switch (period) {
      case "yesterday": {
        const y = subDays(now, 1);
        return { from: startOfDay(y), to: endOfDay(y) };
      }
      case "week":
        return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfDay(now) };
      case "month":
        return { from: startOfMonth(now), to: endOfDay(now) };
      case "custom":
        return { from: startOfDay(new Date(customFrom)), to: endOfDay(new Date(customTo)) };
      default:
        return { from: startOfDay(now), to: endOfDay(now) };
    }
  }, [period, customFrom, customTo]);

  const periodLabel =
    period === "custom"
      ? `${format(range.from, "dd/MM/yyyy")} → ${format(range.to, "dd/MM/yyyy")}`
      : PERIOD_LABELS[period];

  const fetchReports = useServerFn(getActivityReports);
  const previewFn = useServerFn(previewEmailTemplate);
  const sendNowFn = useServerFn(sendActivityReportNow);
  const [sending, setSending] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  async function sendNow() {
    setSending(true);
    try {
      const res: any = await sendNowFn({ data: { origin: window.location.origin } });
      if (!res?.recipients?.length) {
        toast.error("Aucun destinataire configuré dans les réglages e-mail.");
      } else if (!res.ok) {
        toast.error("Envoi en échec, consultez les journaux d'envoi.");
      } else {
        toast.success(`Compte rendu envoyé à ${res.recipients.join(", ")}`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Envoi impossible");
    } finally {
      setSending(false);
    }
  }

  async function sendTest() {
    const to = testEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      toast.error("Adresse e-mail invalide.");
      return;
    }
    setSendingTest(true);
    try {
      const res: any = await sendNowFn({ data: { origin: window.location.origin, to } });
      if (res?.ok) toast.success(`Compte rendu de test envoyé à ${to}`);
      else toast.error(res?.error ?? "Envoi de test en échec.");
    } catch (e: any) {
      toast.error(e?.message ?? "Envoi impossible");
    } finally {
      setSendingTest(false);
    }
  }

  const { data, isLoading } = useQuery({
    queryKey: ["activity-reports", range.from.toISOString(), range.to.toISOString()],
    queryFn: () => fetchReports({ data: { from: range.from.toISOString(), to: range.to.toISOString() } }),
  });

  const members = data?.members ?? [];

  const allRoles = useMemo(() => {
    const set = new Set<string>();
    members.forEach((m: any) => m.roles.forEach((r: string) => set.add(r)));
    return [...set].sort();
  }, [members]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m: any) => {
      const name = `${m.prenom} ${m.nom} ${m.email}`.toLowerCase();
      if (q && !name.includes(q)) return false;
      if (roleFilter !== "all" && !m.roles.includes(roleFilter)) return false;
      return true;
    });
  }, [members, search, roleFilter]);

  const current = members.find((m: any) => m.id === selected) ?? null;

  async function buildPdf(list: any[], filename: string) {
    setExporting(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF();
      list.forEach((m, idx) => {
        if (idx > 0) doc.addPage();
        let y = 18;
        const line = (txt: string, size = 10, bold = false) => {
          doc.setFontSize(size);
          doc.setFont("helvetica", bold ? "bold" : "normal");
          const wrapped = doc.splitTextToSize(txt, 175);
          wrapped.forEach((w: string) => {
            if (y > 280) { doc.addPage(); y = 18; }
            doc.text(w, 16, y);
            y += size * 0.55 + 2;
          });
        };
        line(`Rapport d'activité — ${m.prenom} ${m.nom}`, 16, true);
        line(`${m.roles.map((r: string) => roleLabelFr(r)).join(", ") || "—"} · ${m.email}`);
        line(`Période : ${periodLabel} · Généré le ${format(new Date(), "dd/MM/yyyy HH:mm", { locale: fr })}`);
        y += 3;
        line("Synthèse", 12, true);
        line(
          `Terminées : ${m.counts.done} · En cours : ${m.counts.inProgress} · À venir : ${m.counts.upcoming} · En retard : ${m.counts.overdue} · Complétion : ${m.counts.completionRate}%`,
        );
        const section = (title: string, items: any[], render: (t: any) => string) => {
          y += 3;
          line(title, 12, true);
          if (items.length === 0) { line("Aucune activité enregistrée sur la période."); return; }
          items.forEach((t) => line(`• ${render(t)}`));
        };
        section("Ce qui a été fait", m.done, (t) =>
          `${t.title}${t.context ? ` — ${t.context}` : ""} · ${PRIORITY_LABELS[t.priority] ?? t.priority} · échéance ${fmt(t.due_date)} · réalisé ${fmt(t.completed_at)}${t.note ? ` · ${t.note}` : ""}`,
        );
        section("Tâches en cours", m.inProgress, (t) =>
          `${t.title}${t.context ? ` — ${t.context}` : ""} · ${PRIORITY_LABELS[t.priority] ?? t.priority} · échéance ${fmt(t.due_date)} · ${t.daysSinceStart} j depuis le démarrage`,
        );
        section("Prochaines tâches", m.upcoming, (t) =>
          `${t.title}${t.context ? ` — ${t.context}` : ""} · ${PRIORITY_LABELS[t.priority] ?? t.priority} · échéance ${fmt(t.due_date)}`,
        );
        section("Points d'attention", [...m.overdue, ...m.blocked, ...m.dueSoon], (t) =>
          `${t.title} · ${STATUS_LABELS[t.status] ?? t.status} · échéance ${fmt(t.due_date)}`,
        );
        section("Projets / clients", m.contexts.map((c: string) => ({ c })), (t) => t.c);
      });
      doc.save(filename);
    } finally {
      setExporting(false);
    }
  }

  async function openEmailPreview() {
    try {
      const res = await previewFn({ data: { templateName: "compte-rendu-quotidien" } });
      setEmailPreview({ html: res.html, subject: res.subject as string });
    } catch (e: any) {
      toast.error(e?.message ?? "Aperçu indisponible");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl">Rapports d'activité</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Activité de chaque membre de l'équipe — {periodLabel}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={openEmailPreview}>
            <Mail className="h-4 w-4 mr-2" /> Aperçu de l'email
          </Button>
          <Button size="sm" onClick={sendNow} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Envoyer le compte rendu maintenant
          </Button>
          <div className="flex items-center gap-2">
            <Input
              type="email"
              className="h-9 w-56"
              placeholder="Adresse de test"
              aria-label="Adresse de test"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
            />
            <Button variant="outline" size="sm" onClick={sendTest} disabled={sendingTest}>
              {sendingTest ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
              Envoyer un test à cette adresse
            </Button>
          </div>
          <Button
            size="sm"
            disabled={exporting || filtered.length === 0}
            onClick={() => buildPdf(filtered, `rapports-activite-${format(new Date(), "yyyy-MM-dd")}.pdf`)}
          >
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
            Exporter tous les rapports
          </Button>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((k) => (
            <Button key={k} size="sm" variant={period === k ? "default" : "outline"} onClick={() => setPeriod(k)}>
              {PERIOD_LABELS[k]}
            </Button>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" className="w-auto" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span className="text-muted-foreground text-sm">→</span>
            <Input type="date" className="w-auto" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Rechercher une personne…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="Tous les rôles" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les rôles</SelectItem>
              {allRoles.map((r) => <SelectItem key={r} value={r}>{roleLabelFr(r)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <ArchivedDigests />


      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">Aucune personne ne correspond à ces filtres.</Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((m: any) => (
            <Card
              key={m.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(m.id)}
              onKeyDown={(e) => e.key === "Enter" && setSelected(m.id)}
              className="p-4 cursor-pointer hover:border-primary/40 transition space-y-3"
            >
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={m.avatar_url ?? undefined} alt={`${m.prenom} ${m.nom}`} />
                  <AvatarFallback>{(m.prenom?.[0] ?? "") + (m.nom?.[0] ?? "")}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="font-medium truncate">{m.prenom} {m.nom}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {m.roles.map((r: string) => roleLabelFr(r)).join(", ") || "—"}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat icon={CheckCircle2} label="Terminées" value={m.counts.done} tone="text-emerald-600" />
                <Stat icon={Clock} label="En cours" value={m.counts.inProgress} tone="text-primary" />
                <Stat icon={AlertTriangle} label="En retard" value={m.counts.overdue} tone="text-red-600" />
              </div>
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Charge</span>
                  <span>{m.counts.completionRate}% complété</span>
                </div>
                <Progress value={m.counts.completionRate} />
              </div>
              {m.counts.done + m.counts.inProgress + m.counts.upcoming + m.counts.overdue === 0 && (
                <p className="text-xs text-muted-foreground">Aucune activité enregistrée sur la période.</p>
              )}
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!current} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {current && (
            <>
              <DialogHeader>
                <DialogTitle>Rapport de {current.prenom} {current.nom}</DialogTitle>
              </DialogHeader>
              <div className="space-y-5 text-sm">
                <div className="text-muted-foreground">
                  <div>{current.roles.map((r: string) => roleLabelFr(r)).join(", ") || "—"} · {current.email}</div>
                  <div>Période : {periodLabel} · Généré le {format(new Date(), "dd/MM/yyyy HH:mm", { locale: fr })}</div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <MiniStat label="Terminées" value={current.counts.done} />
                  <MiniStat label="En cours" value={current.counts.inProgress} />
                  <MiniStat label="À venir" value={current.counts.upcoming} />
                  <MiniStat label="En retard" value={current.counts.overdue} />
                  <MiniStat label="Complétion" value={`${current.counts.completionRate}%`} />
                </div>

                <Section title="Ce qui a été fait sur la période" items={current.done} empty="Aucune activité enregistrée sur la période.">
                  {(t: any) => (
                    <>
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.context ? `${t.context} · ` : ""}{PRIORITY_LABELS[t.priority] ?? t.priority} · échéance {fmt(t.due_date)} · réalisé {fmt(t.completed_at)}
                      </div>
                      {t.note && <div className="text-xs mt-1">{t.note}</div>}
                    </>
                  )}
                </Section>

                <Section title="Tâches en cours" items={current.inProgress} empty="Aucune tâche en cours.">
                  {(t: any) => (
                    <>
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.context ? `${t.context} · ` : ""}{PRIORITY_LABELS[t.priority] ?? t.priority} · échéance {fmt(t.due_date)} · {t.daysSinceStart} j depuis le démarrage
                      </div>
                    </>
                  )}
                </Section>

                <Section title="Prochaines tâches" items={current.upcoming} empty="Aucune tâche à venir.">
                  {(t: any) => (
                    <>
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.context ? `${t.context} · ` : ""}{PRIORITY_LABELS[t.priority] ?? t.priority} · échéance {fmt(t.due_date)}
                      </div>
                    </>
                  )}
                </Section>

                <Section
                  title="Points d'attention"
                  items={[...current.overdue, ...current.blocked, ...current.dueSoon]}
                  empty="Aucun point d'attention."
                >
                  {(t: any) => (
                    <>
                      <div className="font-medium flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-red-600" />{t.title}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {STATUS_LABELS[t.status] ?? t.status} · échéance {fmt(t.due_date)}
                      </div>
                    </>
                  )}
                </Section>

                <div>
                  <h3 className="font-display text-base mb-2">Projets / clients</h3>
                  {current.contexts.length === 0 ? (
                    <p className="text-muted-foreground text-xs">Aucune intervention enregistrée sur la période.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {current.contexts.map((c: string) => <Badge key={c} variant="secondary">{c}</Badge>)}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    size="sm"
                    disabled={exporting}
                    onClick={() => buildPdf([current], `rapport-${current.nom}-${format(new Date(), "yyyy-MM-dd")}.pdf`)}
                  >
                    <FileDown className="h-4 w-4 mr-2" /> Exporter en PDF
                  </Button>
                  <Button size="sm" variant="outline" onClick={openEmailPreview}>
                    <Mail className="h-4 w-4 mr-2" /> Aperçu de l'email
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!emailPreview} onOpenChange={(o) => !o && setEmailPreview(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" /> {emailPreview?.subject}
            </DialogTitle>
          </DialogHeader>
          <iframe title="Aperçu de l'email" srcDoc={emailPreview?.html ?? ""} className="w-full h-[60vh] rounded-md border bg-background" />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) {
  return (
    <div className="rounded-md border p-2">
      <Icon className={`h-4 w-4 mx-auto ${tone}`} />
      <div className="text-lg font-display">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border p-3 text-center">
      <div className="text-lg font-display">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Section({ title, items, empty, children }: { title: string; items: any[]; empty: string; children: (t: any) => React.ReactNode }) {
  return (
    <div>
      <h3 className="font-display text-base mb-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-xs">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((t) => (
            <li key={t.id} className="rounded-md border p-3">{children(t)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

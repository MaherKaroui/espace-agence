import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Upload, Trash2, Pencil, ListChecks, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/calendrier-qualiopi")({
  head: () => ({
    meta: [
      { title: "Calendrier Qualiopi — IZISuivis" },
      { name: "description", content: "Agenda et suivi Qualiopi centralisés." },
    ],
  }),
  component: CalendrierQualiopi,
});

type EventStatus = "planifie" | "en_attente" | "realise" | "annule" | "certificat_a_recuperer" | "certificat_recu";
type FollowupStatus = "attente_contrat" | "attente_paiement" | "attente_facture" | "attente_docs" | "attente_retour_certificateur" | "recuperation_certificat" | "autre";

const STATUS_LABELS: Record<EventStatus, string> = {
  planifie: "Planifié",
  en_attente: "En attente",
  realise: "Réalisé",
  annule: "Annulé",
  certificat_a_recuperer: "Certificat à récupérer",
  certificat_recu: "Certificat reçu",
};
const STATUS_COLORS: Record<EventStatus, string> = {
  planifie: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  en_attente: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  realise: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  annule: "bg-muted text-muted-foreground border-border",
  certificat_a_recuperer: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
  certificat_recu: "bg-green-600/15 text-green-700 dark:text-green-300 border-green-600/30",
};
const FOLLOWUP_LABELS: Record<FollowupStatus, string> = {
  attente_contrat: "Attente contrat",
  attente_paiement: "Attente paiement",
  attente_facture: "Attente facture",
  attente_docs: "Attente documents",
  attente_retour_certificateur: "Attente retour certificateur",
  recuperation_certificat: "Récupération certificat",
  autre: "Autre",
};

type ColorTag = "vert" | "bleu" | "orange" | "violet" | "rouge" | "gris";
const COLOR_LABELS: Record<ColorTag, string> = {
  vert: "Vert", bleu: "Bleu", orange: "Orange", violet: "Violet", rouge: "Rouge", gris: "Gris",
};
const COLOR_CLASSES: Record<ColorTag, string> = {
  vert: "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border-emerald-500/60",
  bleu: "bg-blue-500/20 text-blue-800 dark:text-blue-200 border-blue-500/60",
  orange: "bg-orange-500/20 text-orange-800 dark:text-orange-200 border-orange-500/60",
  violet: "bg-violet-500/20 text-violet-800 dark:text-violet-200 border-violet-500/60",
  rouge: "bg-red-500/20 text-red-800 dark:text-red-200 border-red-500/60",
  gris: "bg-muted text-muted-foreground border-border",
};
const COLOR_DOT: Record<ColorTag, string> = {
  vert: "bg-emerald-500", bleu: "bg-blue-500", orange: "bg-orange-500",
  violet: "bg-violet-500", rouge: "bg-red-500", gris: "bg-muted-foreground",
};
function autoColor(auditor?: string | null, certifier?: string | null, certOrg?: string | null): ColorTag | null {
  const a = (auditor ?? "").toLowerCase().replace(/\s+/g, "");
  const c = ((certifier ?? "") + " " + (certOrg ?? "")).toLowerCase().replace(/\s+/g, "");
  if (a.includes("siby") && c.includes("capcert")) return "vert";
  return null;
}
function effectiveColor(e: Partial<CalEvent>): ColorTag | null {
  if (e.color_tag) return e.color_tag as ColorTag;
  return autoColor(e.auditor_name, e.certifier_name, e.certifier_organization);
}

type CalEvent = {
  id: string;
  audit_date: string;
  organism_name: string;
  formation: string | null;
  auditor_name: string | null;
  certifier_name: string | null;
  certifier_organization: string | null;
  certificate_status: string | null;
  status: EventStatus;
  observation: string | null;
  dossier_id: string | null;
  color_tag: ColorTag | null;
  color_manual: boolean;
};
type Pending = {
  id: string;
  organism_name: string;
  certifier: string | null;
  observation: string | null;
  followup_status: FollowupStatus;
  priority: string | null;
  due_date: string | null;
  dossier_id: string | null;
};

const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
function fmtJour(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return JOURS[d.getDay()] ?? "";
}
function ym(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

function CalendrierQualiopi() {
  const { isStaff } = useRole();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [viewMode, setViewMode] = useState<"liste" | "mois">("liste");
  const [filterOrg, setFilterOrg] = useState("");
  const [filterCertifier, setFilterCertifier] = useState("");
  const [filterAuditor, setFilterAuditor] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [editEvent, setEditEvent] = useState<Partial<CalEvent> | null>(null);
  const [editPending, setEditPending] = useState<Partial<Pending> | null>(null);
  const [importPreview, setImportPreview] = useState<{ events: Partial<CalEvent>[]; pendings: Partial<Pending>[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const monthStart = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1), [cursor]);
  const monthEnd = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0), [cursor]);
  const monthLabel = cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  const eventsQ = useQuery({
    queryKey: ["qcal-events", ym(cursor)],
    enabled: !!user,
    queryFn: async () => {
      const from = monthStart.toISOString().slice(0, 10);
      const to = monthEnd.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("qualiopi_calendar_events" as any)
        .select("id, audit_date, organism_name, formation, auditor_name, certifier_name, certifier_organization, certificate_status, status, observation, dossier_id, color_tag, color_manual")
        .gte("audit_date", from)
        .lte("audit_date", to)
        .order("audit_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CalEvent[];
    },
  });

  const pendingQ = useQuery({
    queryKey: ["qcal-pending"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qualiopi_pending_requests" as any)
        .select("id, organism_name, certifier, observation, followup_status, priority, due_date, dossier_id")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Pending[];
    },
  });

  const events = eventsQ.data ?? [];
  const pendings = pendingQ.data ?? [];

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (filterOrg && !e.organism_name.toLowerCase().includes(filterOrg.toLowerCase())) return false;
      if (filterCertifier && !(e.certifier_name ?? "").toLowerCase().includes(filterCertifier.toLowerCase()) && !(e.certifier_organization ?? "").toLowerCase().includes(filterCertifier.toLowerCase())) return false;
      if (filterAuditor && !(e.auditor_name ?? "").toLowerCase().includes(filterAuditor.toLowerCase())) return false;
      if (filterStatus && e.status !== filterStatus) return false;
      return true;
    });
  }, [events, filterOrg, filterCertifier, filterAuditor, filterStatus]);

  const saveEvent = useMutation({
    mutationFn: async (payload: Partial<CalEvent>) => {
      const body: any = {
        audit_date: payload.audit_date,
        organism_name: payload.organism_name,
        formation: payload.formation || null,
        auditor_name: payload.auditor_name || null,
        certifier_name: payload.certifier_name || null,
        certifier_organization: payload.certifier_organization || null,
        certificate_status: payload.certificate_status || null,
        status: payload.status || "planifie",
        observation: payload.observation || null,
        dossier_id: payload.dossier_id || null,
        color_tag: payload.color_tag ?? null,
        color_manual: !!payload.color_manual,
        updated_by: user?.id ?? null,
      };
      if (payload.id) {
        const { error } = await supabase.from("qualiopi_calendar_events" as any).update(body).eq("id", payload.id);
        if (error) throw error;
      } else {
        body.created_by = user?.id ?? null;
        const { error } = await supabase.from("qualiopi_calendar_events" as any).insert(body);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Enregistré");
      setEditEvent(null);
      qc.invalidateQueries({ queryKey: ["qcal-events"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const deleteEvent = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("qualiopi_calendar_events" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Supprimé");
      qc.invalidateQueries({ queryKey: ["qcal-events"] });
    },
  });

  const savePending = useMutation({
    mutationFn: async (payload: Partial<Pending>) => {
      const body: any = {
        organism_name: payload.organism_name,
        certifier: payload.certifier || null,
        observation: payload.observation || null,
        followup_status: payload.followup_status || "autre",
        priority: payload.priority || null,
        due_date: payload.due_date || null,
        dossier_id: payload.dossier_id || null,
        updated_by: user?.id ?? null,
      };
      if (payload.id) {
        const { error } = await supabase.from("qualiopi_pending_requests" as any).update(body).eq("id", payload.id);
        if (error) throw error;
      } else {
        body.created_by = user?.id ?? null;
        const { error } = await supabase.from("qualiopi_pending_requests" as any).insert(body);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Enregistré");
      setEditPending(null);
      qc.invalidateQueries({ queryKey: ["qcal-pending"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur"),
  });

  const deletePending = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("qualiopi_pending_requests" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Supprimé"); qc.invalidateQueries({ queryKey: ["qcal-pending"] }); },
  });

  const importXlsx = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const events: Partial<CalEvent>[] = [];
      const pendings: Partial<Pending>[] = [];
      const normalize = (s: string) => (s ?? "").toString().trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
        if (rows.length === 0) continue;
        const norm = normalize(sheetName);
        if (norm.includes("demande") || norm.includes("en cours")) {
          for (const r of rows) {
            const keys = Object.keys(r).reduce<Record<string, string>>((a, k) => { a[normalize(k)] = k; return a; }, {});
            const org = r[keys["organisme de formation"] ?? keys["organisme"] ?? "Organisme"] ?? "";
            if (!org) continue;
            const cert = r[keys["certificateur"] ?? "Certificateur"] ?? "";
            const obs = r[keys["observation"] ?? keys["observations"] ?? "Observation"] ?? "";
            pendings.push({
              organism_name: String(org),
              certifier: String(cert || "") || null,
              observation: String(obs || "") || null,
              followup_status: "autre",
            });
          }
        } else {
          // Monthly sheet
          for (const r of rows) {
            const keys = Object.keys(r).reduce<Record<string, string>>((a, k) => { a[normalize(k)] = k; return a; }, {});
            const rawDate = r[keys["date"] ?? "Date"];
            if (!rawDate) continue;
            let iso = "";
            if (rawDate instanceof Date) iso = rawDate.toISOString().slice(0, 10);
            else {
              const s = String(rawDate).trim();
              const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
              if (m) {
                const y = m[3].length === 2 ? `20${m[3]}` : m[3];
                iso = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
              } else {
                const parsed = new Date(s);
                if (!isNaN(parsed.getTime())) iso = parsed.toISOString().slice(0, 10);
              }
            }
            if (!iso) continue;
            const org = r[keys["organisme de formation"] ?? keys["organisme"] ?? "Organisme"] ?? "";
            if (!org) continue;
            events.push({
              audit_date: iso,
              organism_name: String(org),
              formation: String(r[keys["formation"] ?? "Formation"] ?? "") || null,
              auditor_name: String(r[keys["nom de l'auditeur"] ?? keys["auditeur"] ?? "Auditeur"] ?? "") || null,
              certifier_name: String(r[keys["certificateur"] ?? "Certificateur"] ?? "") || null,
              certificate_status: String(r[keys["certificat"] ?? "Certificat"] ?? "") || null,
              status: "planifie",
            });
          }
        }
      }
      setImportPreview({ events, pendings });
    } catch (e: any) {
      toast.error(e.message ?? "Import impossible");
    }
  };

  const confirmImport = useMutation({
    mutationFn: async () => {
      if (!importPreview) return;
      if (importPreview.events.length > 0) {
        const rows = importPreview.events.map((e) => ({ ...e, created_by: user?.id ?? null }));
        const { error } = await supabase.from("qualiopi_calendar_events" as any).insert(rows as any);
        if (error) throw error;
      }
      if (importPreview.pendings.length > 0) {
        const rows = importPreview.pendings.map((p) => ({ ...p, created_by: user?.id ?? null }));
        const { error } = await supabase.from("qualiopi_pending_requests" as any).insert(rows as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Import terminé");
      setImportPreview(null);
      qc.invalidateQueries({ queryKey: ["qcal-events"] });
      qc.invalidateQueries({ queryKey: ["qcal-pending"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur import"),
  });

  if (!isStaff) {
    return <Card className="p-6 text-sm">Accès réservé à l'équipe.</Card>;
  }

  const byDay = new Map<string, CalEvent[]>();
  filtered.forEach((e) => {
    const arr = byDay.get(e.audit_date) ?? [];
    arr.push(e);
    byDay.set(e.audit_date, arr);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl flex items-center gap-2"><CalendarDays className="h-6 w-6 text-primary" /> Calendrier Qualiopi</h1>
          <p className="text-sm text-muted-foreground">Agenda des audits et suivi des demandes en cours.</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importXlsx(f); e.target.value = ""; }} />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" /> Importer Excel
          </Button>
        </div>
      </div>

      <Tabs defaultValue="calendrier">
        <TabsList>
          <TabsTrigger value="calendrier"><CalendarDays className="h-4 w-4 mr-2" /> Calendrier</TabsTrigger>
          <TabsTrigger value="demandes"><ListChecks className="h-4 w-4 mr-2" /> Demandes en cours ({pendings.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="calendrier" className="space-y-3">
          <Card className="p-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="capitalize font-medium min-w-[180px] text-center">{monthLabel}</div>
            <Button variant="outline" size="sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => setCursor(new Date())}>Aujourd'hui</Button>
            <div className="flex-1" />
            <Select value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="liste">Vue liste</SelectItem>
                <SelectItem value="mois">Vue mois</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => setEditEvent({ audit_date: new Date().toISOString().slice(0, 10), status: "planifie" })}>
              <Plus className="h-4 w-4 mr-1" /> Nouvel audit
            </Button>
          </Card>

          <Card className="p-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Input placeholder="Organisme" value={filterOrg} onChange={(e) => setFilterOrg(e.target.value)} />
            <Input placeholder="Auditeur" value={filterAuditor} onChange={(e) => setFilterAuditor(e.target.value)} />
            <Input placeholder="Certificateur" value={filterCertifier} onChange={(e) => setFilterCertifier(e.target.value)} />
            <Select value={filterStatus || "all"} onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Statut" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous statuts</SelectItem>
                {(Object.keys(STATUS_LABELS) as EventStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Card>

          <Card className="p-3 flex flex-wrap items-center gap-3 text-xs">
            <span className="font-medium text-muted-foreground">Légende couleurs :</span>
            {(Object.keys(COLOR_LABELS) as ColorTag[]).map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5">
                <span className={`h-3 w-3 rounded-full ${COLOR_DOT[c]}`} />
                {COLOR_LABELS[c]}
              </span>
            ))}
            <span className="text-muted-foreground ml-2">• Auto : SIBY + CAPCERT ⇒ vert</span>
          </Card>

          {eventsQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : viewMode === "liste" ? (
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left p-2">Date</th>
                    <th className="text-left p-2">Jour</th>
                    <th className="text-left p-2">Organisme</th>
                    <th className="text-left p-2">Formation</th>
                    <th className="text-left p-2">Auditeur</th>
                    <th className="text-left p-2">Certificateur</th>
                    <th className="text-left p-2">Certificat</th>
                    <th className="text-left p-2">Statut</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">Aucun évènement ce mois-ci.</td></tr>
                  )}
                  {filtered.map((e) => {
                    const col = effectiveColor(e);
                    return (
                    <tr key={e.id} className="border-t">
                      <td className="p-2 whitespace-nowrap align-middle">
                        <div className="flex items-center gap-2">
                          <span className={`inline-block h-3 w-3 rounded-full ${col ? COLOR_DOT[col] : "bg-transparent border border-border"}`} title={col ? COLOR_LABELS[col] : "Sans couleur"} />
                          <span>{e.audit_date}</span>
                        </div>
                      </td>
                      <td className="p-2 whitespace-nowrap text-muted-foreground">{fmtJour(e.audit_date)}</td>
                      <td className="p-2 font-medium">{e.organism_name}</td>
                      <td className="p-2">{e.formation ?? "—"}</td>
                      <td className="p-2">{e.auditor_name ?? "—"}</td>
                      <td className="p-2">{e.certifier_name || e.certifier_organization || "—"}</td>
                      <td className="p-2">{e.certificate_status ?? "—"}</td>
                      <td className="p-2">
                        <div className="flex flex-col gap-1">
                          <Badge className={STATUS_COLORS[e.status]}>{STATUS_LABELS[e.status]}</Badge>
                          {col && <Badge variant="outline" className={COLOR_CLASSES[col]}>{COLOR_LABELS[col]}</Badge>}
                        </div>
                      </td>
                      <td className="p-2 text-right whitespace-nowrap">
                        <Button variant="ghost" size="icon" onClick={() => setEditEvent(e)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { if (confirm("Supprimer cet évènement ?")) deleteEvent.mutate(e.id); }}><Trash2 className="h-4 w-4" /></Button>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </Card>
          ) : (
            <Card className="p-3">
              <div className="grid grid-cols-7 gap-1 text-xs">
                {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => (
                  <div key={d} className="p-2 text-center font-medium text-muted-foreground">{d}</div>
                ))}
                {(() => {
                  const cells: React.ReactNode[] = [];
                  const first = monthStart;
                  const firstWeekday = (first.getDay() + 6) % 7; // Monday=0
                  for (let i = 0; i < firstWeekday; i++) cells.push(<div key={`pad-${i}`} />);
                  for (let d = 1; d <= monthEnd.getDate(); d++) {
                    const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                    const dayEvents = byDay.get(dateStr) ?? [];
                    cells.push(
                      <div key={dateStr} className="border rounded-md min-h-[90px] p-1 flex flex-col gap-1">
                        <div className="text-xs font-medium">{d}</div>
                        {dayEvents.map((ev) => {
                          const col = effectiveColor(ev);
                          const cls = col ? COLOR_CLASSES[col] : STATUS_COLORS[ev.status];
                          return (
                          <button key={ev.id} onClick={() => setEditEvent(ev)} className={`text-left text-[10px] truncate rounded px-1 py-0.5 border ${cls}`}>
                            {ev.organism_name}{ev.formation ? ` — ${ev.formation}` : ""}
                          </button>
                        );})}
                      </div>
                    );
                  }
                  return cells;
                })()}
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="demandes" className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setEditPending({ followup_status: "autre" })}><Plus className="h-4 w-4 mr-1" /> Nouvelle demande</Button>
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left p-2">Organisme</th>
                  <th className="text-left p-2">Certificateur</th>
                  <th className="text-left p-2">Observation</th>
                  <th className="text-left p-2">Statut de suivi</th>
                  <th className="text-left p-2">Échéance</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {pendings.length === 0 && (
                  <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Aucune demande en cours.</td></tr>
                )}
                {pendings.map((p) => (
                  <tr key={p.id} className="border-t align-top">
                    <td className="p-2 font-medium">{p.organism_name}</td>
                    <td className="p-2">{p.certifier ?? "—"}</td>
                    <td className="p-2 whitespace-pre-wrap max-w-md">{p.observation ?? "—"}</td>
                    <td className="p-2"><Badge variant="outline">{FOLLOWUP_LABELS[p.followup_status]}</Badge></td>
                    <td className="p-2 whitespace-nowrap">{p.due_date ?? "—"}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon" onClick={() => setEditPending(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { if (confirm("Supprimer cette demande ?")) deletePending.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Event dialog */}
      <Dialog open={!!editEvent} onOpenChange={(o) => !o && setEditEvent(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editEvent?.id ? "Modifier l'audit" : "Nouvel audit"}</DialogTitle></DialogHeader>
          {editEvent && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Date</Label><Input type="date" value={editEvent.audit_date ?? ""} onChange={(e) => setEditEvent({ ...editEvent, audit_date: e.target.value })} /></div>
              <div>
                <Label>Statut</Label>
                <Select value={editEvent.status ?? "planifie"} onValueChange={(v) => setEditEvent({ ...editEvent, status: v as EventStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_LABELS) as EventStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2"><Label>Organisme de formation *</Label><Input value={editEvent.organism_name ?? ""} onChange={(e) => setEditEvent({ ...editEvent, organism_name: e.target.value })} /></div>
              <div><Label>Formation</Label><Input value={editEvent.formation ?? ""} onChange={(e) => setEditEvent({ ...editEvent, formation: e.target.value })} placeholder="AF, CFA, VAE, AF-CFA…" /></div>
              <div><Label>Nom de l'auditeur</Label><Input value={editEvent.auditor_name ?? ""} onChange={(e) => setEditEvent({ ...editEvent, auditor_name: e.target.value })} /></div>
              <div><Label>Certificateur</Label><Input value={editEvent.certifier_name ?? ""} onChange={(e) => setEditEvent({ ...editEvent, certifier_name: e.target.value })} placeholder="BCI, CAPCERT, Qualipro…" /></div>
              <div><Label>Organisme certificateur</Label><Input value={editEvent.certifier_organization ?? ""} onChange={(e) => setEditEvent({ ...editEvent, certifier_organization: e.target.value })} /></div>
              <div className="sm:col-span-2"><Label>Certificat</Label><Input value={editEvent.certificate_status ?? ""} onChange={(e) => setEditEvent({ ...editEvent, certificate_status: e.target.value })} /></div>
              <div className="sm:col-span-2">
                <Label>Couleur</Label>
                <Select
                  value={editEvent.color_manual ? (editEvent.color_tag ?? "auto") : "auto"}
                  onValueChange={(v) => {
                    if (v === "auto") setEditEvent({ ...editEvent, color_tag: null, color_manual: false });
                    else setEditEvent({ ...editEvent, color_tag: v as ColorTag, color_manual: true });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      <span className="inline-flex items-center gap-2">
                        <span className={`h-3 w-3 rounded-full ${(() => { const c = autoColor(editEvent.auditor_name, editEvent.certifier_name, editEvent.certifier_organization); return c ? COLOR_DOT[c] : "border border-border"; })()}`} />
                        Automatique {(() => { const c = autoColor(editEvent.auditor_name, editEvent.certifier_name, editEvent.certifier_organization); return c ? `(${COLOR_LABELS[c]})` : "(aucune)"; })()}
                      </span>
                    </SelectItem>
                    {(Object.keys(COLOR_LABELS) as ColorTag[]).map((c) => (
                      <SelectItem key={c} value={c}>
                        <span className="inline-flex items-center gap-2">
                          <span className={`h-3 w-3 rounded-full ${COLOR_DOT[c]}`} />
                          {COLOR_LABELS[c]}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Un choix manuel reste prioritaire sur la règle automatique.</p>
              </div>
              <div className="sm:col-span-2"><Label>Observation</Label><Textarea value={editEvent.observation ?? ""} onChange={(e) => setEditEvent({ ...editEvent, observation: e.target.value })} rows={3} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEvent(null)}>Annuler</Button>
            <Button
              onClick={() => {
                if (!editEvent?.audit_date || !editEvent?.organism_name) { toast.error("Date et organisme requis"); return; }
                saveEvent.mutate(editEvent);
              }}
              disabled={saveEvent.isPending}
            >Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pending dialog */}
      <Dialog open={!!editPending} onOpenChange={(o) => !o && setEditPending(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editPending?.id ? "Modifier la demande" : "Nouvelle demande en cours"}</DialogTitle></DialogHeader>
          {editPending && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Label>Organisme *</Label><Input value={editPending.organism_name ?? ""} onChange={(e) => setEditPending({ ...editPending, organism_name: e.target.value })} /></div>
              <div><Label>Certificateur</Label><Input value={editPending.certifier ?? ""} onChange={(e) => setEditPending({ ...editPending, certifier: e.target.value })} /></div>
              <div>
                <Label>Statut de suivi</Label>
                <Select value={editPending.followup_status ?? "autre"} onValueChange={(v) => setEditPending({ ...editPending, followup_status: v as FollowupStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FOLLOWUP_LABELS) as FollowupStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>{FOLLOWUP_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Priorité</Label><Input value={editPending.priority ?? ""} onChange={(e) => setEditPending({ ...editPending, priority: e.target.value })} placeholder="Haute, Moyenne, Basse" /></div>
              <div><Label>Échéance</Label><Input type="date" value={editPending.due_date ?? ""} onChange={(e) => setEditPending({ ...editPending, due_date: e.target.value })} /></div>
              <div className="sm:col-span-2"><Label>Observation</Label><Textarea rows={4} value={editPending.observation ?? ""} onChange={(e) => setEditPending({ ...editPending, observation: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPending(null)}>Annuler</Button>
            <Button
              onClick={() => {
                if (!editPending?.organism_name) { toast.error("Organisme requis"); return; }
                savePending.mutate(editPending);
              }}
              disabled={savePending.isPending}
            >Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import preview */}
      <Dialog open={!!importPreview} onOpenChange={(o) => !o && setImportPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Aperçu de l'import</DialogTitle></DialogHeader>
          {importPreview && (
            <div className="space-y-3 text-sm">
              <div className="flex gap-4">
                <Badge variant="outline">{importPreview.events.length} évènements calendrier</Badge>
                <Badge variant="outline">{importPreview.pendings.length} demandes en cours</Badge>
              </div>
              {importPreview.events.length > 0 && (
                <div className="max-h-60 overflow-auto border rounded-md">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 sticky top-0"><tr><th className="p-2 text-left">Date</th><th className="p-2 text-left">Organisme</th><th className="p-2 text-left">Formation</th><th className="p-2 text-left">Auditeur</th><th className="p-2 text-left">Certificateur</th></tr></thead>
                    <tbody>
                      {importPreview.events.slice(0, 100).map((e, i) => (
                        <tr key={i} className="border-t"><td className="p-2">{e.audit_date}</td><td className="p-2">{e.organism_name}</td><td className="p-2">{e.formation}</td><td className="p-2">{e.auditor_name}</td><td className="p-2">{e.certifier_name}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {importPreview.pendings.length > 0 && (
                <div className="max-h-40 overflow-auto border rounded-md">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 sticky top-0"><tr><th className="p-2 text-left">Organisme</th><th className="p-2 text-left">Certificateur</th><th className="p-2 text-left">Observation</th></tr></thead>
                    <tbody>
                      {importPreview.pendings.slice(0, 100).map((p, i) => (
                        <tr key={i} className="border-t"><td className="p-2">{p.organism_name}</td><td className="p-2">{p.certifier}</td><td className="p-2">{p.observation}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportPreview(null)}><X className="h-4 w-4 mr-1" /> Annuler</Button>
            <Button onClick={() => confirmImport.mutate()} disabled={confirmImport.isPending}>Importer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

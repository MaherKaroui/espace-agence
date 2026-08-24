import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  parseQualiopiWorkbook, normalizeKey, jourFr, downloadQualiopiWorkbook,
  type ParsedRow, type SheetReport,
} from "@/lib/qualiopi-xlsx";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Upload, Download, Trash2, Pencil, ListChecks } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/calendrier-qualiopi")({
  head: () => ({
    meta: [
      { title: "Calendrier Qualiopi — IZISuivis" },
      { name: "description", content: "Agenda des audits Qualiopi et suivi des demandes en cours." },
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
const CERT_COLOR_RULES: Array<{ key: string; color: ColorTag; label: string }> = [
  { key: "capcert", color: "vert", label: "CAPCERT" },
  { key: "bci", color: "bleu", label: "BCI" },
  { key: "qualipro", color: "violet", label: "QUALIPRO" },
  { key: "icpf", color: "orange", label: "ICPF" },
  { key: "wecert", color: "rouge", label: "WECERT" },
  { key: "afnor", color: "gris", label: "AFNOR" },
];
function normalizeCert(s?: string | null): string {
  return (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, "");
}
function autoColor(_auditor?: string | null, certifier?: string | null, certOrg?: string | null): ColorTag | null {
  const c = normalizeCert((certifier ?? "") + " " + (certOrg ?? ""));
  for (const rule of CERT_COLOR_RULES) if (c.includes(rule.key)) return rule.color;
  return null;
}
function effectiveColor(e: Partial<CalEvent>): ColorTag | null {
  if (e.color_manual && e.color_tag) return e.color_tag as ColorTag;
  if (e.color_tag) return e.color_tag as ColorTag;
  return autoColor(e.auditor_name, e.certifier_name, e.certifier_organization);
}

type CalEvent = {
  id: string;
  tuteur: string | null;
  audit_date: string | null;
  organism_name: string;
  formation: string | null;
  auditor_name: string | null;
  certifier_name: string | null;
  certifier_organization: string | null;
  certificate_status: string | null;
  notes_suivi: string | null;
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

const EVENT_COLUMNS =
  "id, tuteur, audit_date, organism_name, formation, auditor_name, certifier_name, certifier_organization, certificate_status, notes_suivi, status, observation, dossier_id, color_tag, color_manual";

function ym(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

type ImportPlan = {
  sheets: SheetReport[];
  problems: string[];
  creates: ParsedRow[];
  updates: Array<{ id: string; row: ParsedRow; patch: Record<string, unknown> }>;
  unchanged: number;
};

function CalendrierQualiopi() {
  const { isStaff } = useRole();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [viewMode, setViewMode] = useState<"liste" | "mois">("mois");
  const [filterOrg, setFilterOrg] = useState("");
  const [filterCertifier, setFilterCertifier] = useState("");
  const [filterAuditor, setFilterAuditor] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [editEvent, setEditEvent] = useState<Partial<CalEvent> | null>(null);
  const [editPending, setEditPending] = useState<Partial<Pending> | null>(null);
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const monthStart = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1), [cursor]);
  const monthEnd = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0), [cursor]);
  const monthLabel = cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  const fmtLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const eventsQ = useQuery({
    queryKey: ["qcal-events", ym(cursor)],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qualiopi_calendar_events" as any)
        .select(EVENT_COLUMNS)
        .gte("audit_date", fmtLocal(monthStart))
        .lte("audit_date", fmtLocal(monthEnd))
        .order("audit_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CalEvent[];
    },
  });

  // Demandes en cours = évènements sans date d'audit (feuille « Demande En cours »)
  const demandesQ = useQuery({
    queryKey: ["qcal-demandes"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qualiopi_calendar_events" as any)
        .select(EVENT_COLUMNS)
        .is("audit_date", null)
        .order("organism_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CalEvent[];
    },
  });

  // Ancien suivi (table qualiopi_pending_requests) — conservé, affiché en complément
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
  const demandes = demandesQ.data ?? [];
  const pendings = pendingQ.data ?? [];

  const filtered = useMemo(() => events.filter((e) => {
    if (filterOrg && !e.organism_name.toLowerCase().includes(filterOrg.toLowerCase())) return false;
    if (filterCertifier && !(e.certifier_name ?? "").toLowerCase().includes(filterCertifier.toLowerCase()) && !(e.certifier_organization ?? "").toLowerCase().includes(filterCertifier.toLowerCase())) return false;
    if (filterAuditor && !(e.auditor_name ?? "").toLowerCase().includes(filterAuditor.toLowerCase())) return false;
    if (filterStatus && e.status !== filterStatus) return false;
    return true;
  }), [events, filterOrg, filterCertifier, filterAuditor, filterStatus]);

  const saveEvent = useMutation({
    mutationFn: async (payload: Partial<CalEvent>) => {
      const body: any = {
        tuteur: payload.tuteur || null,
        audit_date: payload.audit_date || null,
        organism_name: payload.organism_name,
        formation: payload.formation || null,
        auditor_name: payload.auditor_name || null,
        certifier_name: payload.certifier_name || null,
        certifier_organization: payload.certifier_organization || null,
        certificate_status: payload.certificate_status || null,
        notes_suivi: payload.notes_suivi || null,
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
      qc.invalidateQueries({ queryKey: ["qcal-demandes"] });
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
      qc.invalidateQueries({ queryKey: ["qcal-demandes"] });
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
      const { error } = await supabase.from("qualiopi_pending_requests" as any).update(body).eq("id", payload.id!);
      if (error) throw error;
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

  const exportXlsx = async () => {
    const { data, error } = await supabase.from("qualiopi_calendar_events" as any).select(EVENT_COLUMNS);
    if (error) { toast.error(error.message); return; }
    const rows = (data ?? []) as unknown as CalEvent[];
    downloadQualiopiWorkbook(rows, cursor.getFullYear());
    toast.success(`${rows.length} ligne(s) exportée(s)`);
  };

  const importXlsx = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseQualiopiWorkbook(buf);
      if (parsed.rows.length === 0 && parsed.problems.length > 0) {
        toast.error(parsed.problems[0]);
      }

      const { data: existing, error } = await supabase
        .from("qualiopi_calendar_events" as any)
        .select(EVENT_COLUMNS);
      if (error) throw error;

      // Clés de dédoublonnage : organisme + date, ou organisme + formation pour les demandes
      const byDate = new Map<string, any>();
      const byFormation = new Map<string, any>();
      ((existing ?? []) as any[]).forEach((e) => {
        if (e.audit_date) byDate.set(`${e.audit_date}|${normalizeKey(e.organism_name)}`, e);
        else byFormation.set(`${normalizeKey(e.organism_name)}|${normalizeKey(e.formation)}`, e);
      });

      const creates: ParsedRow[] = [];
      const updates: ImportPlan["updates"] = [];
      let unchanged = 0;
      const FIELDS = ["tuteur", "formation", "auditor_name", "certifier_name", "certificate_status", "notes_suivi", "observation"] as const;

      for (const row of parsed.rows) {
        const found = row.audit_date
          ? byDate.get(`${row.audit_date}|${normalizeKey(row.organism_name)}`)
          : byFormation.get(`${normalizeKey(row.organism_name)}|${normalizeKey(row.formation)}`);
        if (!found) { creates.push(row); continue; }
        const patch: Record<string, unknown> = {};
        FIELDS.forEach((k) => {
          const v = (row as any)[k];
          if (v && v !== found[k]) patch[k] = v;
        });
        if (Object.keys(patch).length > 0) updates.push({ id: found.id, row, patch });
        else unchanged++;
      }

      setImportPlan({ sheets: parsed.sheets, problems: parsed.problems, creates, updates, unchanged });
    } catch (e: any) {
      toast.error(e.message ?? "Import impossible");
    }
  };

  const confirmImport = useMutation({
    mutationFn: async () => {
      if (!importPlan) return;
      const { creates, updates } = importPlan;
      if (creates.length > 0) {
        const rows = creates.map((r) => ({
          tuteur: r.tuteur,
          audit_date: r.audit_date,
          organism_name: r.organism_name,
          formation: r.formation,
          auditor_name: r.auditor_name,
          certifier_name: r.certifier_name,
          certificate_status: r.certificate_status,
          notes_suivi: r.notes_suivi,
          observation: r.observation,
          status: "planifie",
          created_by: user?.id ?? null,
        }));
        const { error } = await supabase.from("qualiopi_calendar_events" as any).insert(rows as any);
        if (error) throw error;
      }
      for (const u of updates) {
        const { error } = await supabase
          .from("qualiopi_calendar_events" as any)
          .update({ ...u.patch, updated_by: user?.id ?? null } as any)
          .eq("id", u.id);
        if (error) throw error;
      }
      await supabase.rpc("log_event" as any, {
        _action: "qualiopi_calendar_import",
        _entity_type: "qualiopi_calendar_events",
        _entity_id: null,
        _severity: "info",
        _metadata: {
          created: creates.length,
          updated: updates.length,
          unchanged: importPlan.unchanged,
          sheets: importPlan.sheets.map((s) => ({ sheet: s.sheet, kind: s.kind, kept: s.kept })),
        },
      } as any);
    },
    onSuccess: () => {
      toast.success(`Import terminé — ${importPlan?.creates.length ?? 0} création(s), ${importPlan?.updates.length ?? 0} mise(s) à jour`);
      setImportPlan(null);
      qc.invalidateQueries({ queryKey: ["qcal-events"] });
      qc.invalidateQueries({ queryKey: ["qcal-demandes"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erreur import"),
  });

  if (!isStaff) {
    return <Card className="p-6 text-sm">Accès réservé à l'équipe.</Card>;
  }

  const byDay = new Map<string, CalEvent[]>();
  filtered.forEach((e) => {
    if (!e.audit_date) return;
    const arr = byDay.get(e.audit_date) ?? [];
    arr.push(e);
    byDay.set(e.audit_date, arr);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl flex items-center gap-2"><CalendarDays className="h-6 w-6 text-primary" /> Calendrier Qualiopi</h1>
          <p className="text-sm text-muted-foreground">Structure du fichier de référence : demandes en cours, puis un onglet par mois.</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importXlsx(f); e.target.value = ""; }} />
          <Button variant="outline" onClick={exportXlsx}><Download className="h-4 w-4 mr-2" /> Exporter Excel</Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" /> Importer un fichier Excel
          </Button>
        </div>
      </div>

      {/* ===== Vue par mois ===== */}
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
        <Button size="sm" onClick={() => setEditEvent({ audit_date: fmtLocal(new Date()), status: "planifie" })}>
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
        <span className="font-medium text-muted-foreground">Couleurs par certificateur :</span>
        {CERT_COLOR_RULES.map((r) => (
          <span key={r.key} className="inline-flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-full ${COLOR_DOT[r.color]}`} />
            {r.label}
          </span>
        ))}
        <span className="text-muted-foreground ml-2">• Autre certificateur : sans couleur</span>
      </Card>

      {eventsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : viewMode === "liste" ? (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left p-2">Tuteur</th>
                <th className="text-left p-2">Date</th>
                <th className="text-left p-2">Jour</th>
                <th className="text-left p-2">Organisme</th>
                <th className="text-left p-2">Formation</th>
                <th className="text-left p-2">Auditeur</th>
                <th className="text-left p-2">Certificateur</th>
                <th className="text-left p-2">Certificat</th>
                <th className="text-left p-2">Notes de suivi</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="p-4 text-center text-muted-foreground">Aucun évènement ce mois-ci.</td></tr>
              )}
              {filtered.map((e) => {
                const col = effectiveColor(e);
                return (
                  <tr key={e.id} className="border-t align-top">
                    <td className="p-2 whitespace-nowrap">{e.tuteur ?? "—"}</td>
                    <td className="p-2 whitespace-nowrap align-middle">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-3 w-3 rounded-full ${col ? COLOR_DOT[col] : "bg-transparent border border-border"}`} title={col ? COLOR_LABELS[col] : "Sans couleur"} />
                        <span>{e.audit_date ?? "—"}</span>
                      </div>
                    </td>
                    <td className="p-2 whitespace-nowrap text-muted-foreground">{jourFr(e.audit_date) || "—"}</td>
                    <td className="p-2 font-medium">{e.organism_name}</td>
                    <td className="p-2">{e.formation ?? "—"}</td>
                    <td className="p-2">{e.auditor_name ?? "—"}</td>
                    <td className="p-2">{e.certifier_name || e.certifier_organization || "—"}</td>
                    <td className="p-2">{e.certificate_status ?? "—"}</td>
                    <td className="p-2 whitespace-pre-wrap max-w-xs">{e.notes_suivi ?? "—"}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon" onClick={() => setEditEvent(e)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { if (confirm("Supprimer cet évènement ?")) deleteEvent.mutate(e.id); }}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                );
              })}
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
              const firstWeekday = (monthStart.getDay() + 6) % 7;
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
                      );
                    })}
                  </div>
                );
              }
              return cells;
            })()}
          </div>
        </Card>
      )}

      {/* ===== Ancien suivi conservé ===== */}
      {pendings.length > 0 && (
        <Card className="overflow-hidden">
          <div className="p-3 border-b bg-muted/30 font-medium">Suivi historique des demandes ({pendings.length})</div>
          <div className="overflow-x-auto">
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
          </div>
        </Card>
      )}

      {/* Event dialog */}
      <Dialog open={!!editEvent} onOpenChange={(o) => !o && setEditEvent(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editEvent?.id ? "Modifier la ligne" : editEvent?.audit_date ? "Nouvel audit" : "Nouvelle demande"}</DialogTitle></DialogHeader>
          {editEvent && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Tuteur</Label><Input value={editEvent.tuteur ?? ""} onChange={(e) => setEditEvent({ ...editEvent, tuteur: e.target.value })} placeholder="Chanez (demande)…" /></div>
              <div>
                <Label>Date d'audit</Label>
                <Input type="date" value={editEvent.audit_date ?? ""} onChange={(e) => setEditEvent({ ...editEvent, audit_date: e.target.value || null })} />
                <p className="text-xs text-muted-foreground mt-1">Vide = demande en cours, non planifiée.</p>
              </div>
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
              <div><Label>Jour</Label><Input value={jourFr(editEvent.audit_date) || "—"} readOnly disabled /></div>
              <div className="sm:col-span-2"><Label>Organisme de formation *</Label><Input value={editEvent.organism_name ?? ""} onChange={(e) => setEditEvent({ ...editEvent, organism_name: e.target.value })} /></div>
              <div><Label>Formation</Label><Input value={editEvent.formation ?? ""} onChange={(e) => setEditEvent({ ...editEvent, formation: e.target.value })} placeholder="AF, CFA, VAE…" /></div>
              <div><Label>Nom de l'auditeur</Label><Input value={editEvent.auditor_name ?? ""} onChange={(e) => setEditEvent({ ...editEvent, auditor_name: e.target.value })} /></div>
              <div><Label>Certificateur</Label><Input value={editEvent.certifier_name ?? ""} onChange={(e) => setEditEvent({ ...editEvent, certifier_name: e.target.value })} placeholder="Nom du certificateur" /></div>
              <div><Label>Certificat</Label><Input value={editEvent.certificate_status ?? ""} onChange={(e) => setEditEvent({ ...editEvent, certificate_status: e.target.value })} /></div>
              <div className="sm:col-span-2">
                <Label>Couleur</Label>
                <Select
                  value={editEvent.color_manual ? (editEvent.color_tag ?? "auto") : "auto"}
                  onValueChange={(v) => {
                    if (v === "auto") setEditEvent({ ...editEvent, color_tag: null, color_manual: false });
                    else setEditEvent({ ...editEvent, color_tag: v as ColorTag, color_manual: true });
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      <span className="inline-flex items-center gap-2">
                        <span className={`h-3 w-3 rounded-full ${(() => { const c = autoColor(editEvent.auditor_name, editEvent.certifier_name, editEvent.certifier_organization); return c ? COLOR_DOT[c] : "border border-border"; })()}`} />
                        Auto selon certificateur {(() => { const c = autoColor(editEvent.auditor_name, editEvent.certifier_name, editEvent.certifier_organization); return c ? `(${COLOR_LABELS[c]})` : "(aucune)"; })()}
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
              <div className="sm:col-span-2"><Label>Notes de suivi</Label><Textarea value={editEvent.notes_suivi ?? ""} onChange={(e) => setEditEvent({ ...editEvent, notes_suivi: e.target.value })} rows={2} /></div>
              <div className="sm:col-span-2"><Label>Observation</Label><Textarea value={editEvent.observation ?? ""} onChange={(e) => setEditEvent({ ...editEvent, observation: e.target.value })} rows={2} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEvent(null)}>Annuler</Button>
            <Button
              onClick={() => {
                if (!editEvent?.organism_name) { toast.error("Organisme requis"); return; }
                saveEvent.mutate(editEvent);
              }}
              disabled={saveEvent.isPending}
            >Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pending dialog (suivi historique) */}
      <Dialog open={!!editPending} onOpenChange={(o) => !o && setEditPending(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Modifier la demande</DialogTitle></DialogHeader>
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
              <div><Label>Priorité</Label><Input value={editPending.priority ?? ""} onChange={(e) => setEditPending({ ...editPending, priority: e.target.value })} /></div>
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

      {/* Aperçu d'import */}
      <Dialog open={!!importPlan} onOpenChange={(o) => !o && setImportPlan(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Aperçu de l'import — aucune écriture pour l'instant</DialogTitle></DialogHeader>
          {importPlan && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{importPlan.creates.length} création(s)</Badge>
                <Badge variant="outline">{importPlan.updates.length} mise(s) à jour</Badge>
                <Badge variant="outline">{importPlan.unchanged} inchangée(s)</Badge>
                <Badge variant="outline">0 suppression</Badge>
              </div>
              {importPlan.problems.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 space-y-1">
                  {importPlan.problems.map((p, i) => <div key={i} className="text-destructive text-xs">{p}</div>)}
                </div>
              )}
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="p-2 text-left">Feuille</th>
                      <th className="p-2 text-left">Type</th>
                      <th className="p-2 text-left">Lignes lues</th>
                      <th className="p-2 text-left">Retenues</th>
                      <th className="p-2 text-left">Ignorées (motif)</th>
                      <th className="p-2 text-left">Colonnes non reconnues</th>
                      <th className="p-2 text-left">Colonnes absentes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPlan.sheets.map((s) => (
                      <tr key={s.sheet} className="border-t align-top">
                        <td className="p-2 font-medium">{s.sheet}</td>
                        <td className="p-2">{s.kind}</td>
                        <td className="p-2">{s.rowsRead}</td>
                        <td className="p-2">{s.kept}</td>
                        <td className="p-2">{s.skipped.length === 0 ? "—" : s.skipped.map((k) => `${k.count} × ${k.reason}`).join(" · ")}</td>
                        <td className="p-2">{s.unknownColumns.length === 0 ? "—" : s.unknownColumns.join(", ")}</td>
                        <td className="p-2">{s.missingColumns.length === 0 ? "—" : s.missingColumns.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(importPlan.creates.length > 0 || importPlan.updates.length > 0) && (
                <div className="max-h-60 overflow-auto border rounded-md">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 sticky top-0">
                      <tr>
                        <th className="p-2 text-left">Action</th>
                        <th className="p-2 text-left">Tuteur</th>
                        <th className="p-2 text-left">Date</th>
                        <th className="p-2 text-left">Organisme</th>
                        <th className="p-2 text-left">Formation</th>
                        <th className="p-2 text-left">Auditeur</th>
                        <th className="p-2 text-left">Certificateur</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...importPlan.creates.map((r) => ({ kind: "Création", r })),
                        ...importPlan.updates.map((u) => ({ kind: "Mise à jour", r: u.row })),
                      ].map((x, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-2">{x.kind}</td>
                          <td className="p-2">{x.r.tuteur ?? "—"}</td>
                          <td className="p-2">{x.r.audit_date ?? "—"}</td>
                          <td className="p-2">{x.r.organism_name}</td>
                          <td className="p-2">{x.r.formation ?? "—"}</td>
                          <td className="p-2">{x.r.auditor_name ?? "—"}</td>
                          <td className="p-2">{x.r.certifier_name ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Aucun évènement existant absent du fichier ne sera supprimé.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportPlan(null)}>Annuler</Button>
            <Button onClick={() => confirmImport.mutate()} disabled={confirmImport.isPending || !importPlan || (importPlan.creates.length === 0 && importPlan.updates.length === 0)}>
              Confirmer l'import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

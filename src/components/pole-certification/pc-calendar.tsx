import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Download, FileWarning, Link2, Video } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  addDaysIso, currentEtapes, docState, etapeTone, frDate, todayIso, PC_TONES, type PcTone,
} from "@/lib/pole-certification";
import type { PcViewProps } from "./pc-view-types";

type Kind = "echeance" | "rdv" | "peremption" | "lien";
interface CalEvent {
  id: string;
  day: string;            // YYYY-MM-DD (Europe/Paris)
  at: string | null;      // ISO datetime si horaire
  kind: Kind;
  title: string;
  detail: string;
  tone: PcTone;
  dossierId: string;
}
const KIND_ICON = { echeance: CalendarClock, rdv: Video, peremption: FileWarning, lien: Link2 } as const;
const KIND_LABEL: Record<Kind, string> = { echeance: "Échéance", rdv: "RDV", peremption: "Péremption", lien: "Lien CDC" };
const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const parisDay = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const parisTime = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const dow = (iso: string) => (new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7; // 0 = lundi
const startOfWeek = (iso: string) => addDaysIso(iso, -dow(iso));

function buildEvents({ dossiers, etapes, documents }: PcViewProps, today: string): CalEvent[] {
  const byId = new Map(dossiers.map((d) => [d.id, d]));
  const out: CalEvent[] = [];
  for (const e of currentEtapes(etapes.filter((x) => byId.has(x.dossier_id)))) {
    const d = byId.get(e.dossier_id)!;
    const step = `Étape ${e.ordre} — ${e.intitule}`;
    if (e.date_echeance && e.statut !== "valide")
      out.push({ id: e.id + ":ech", day: e.date_echeance, at: null, kind: "echeance", title: d.titre, detail: step, tone: etapeTone(e, today), dossierId: d.id });
    if (e.event_at)
      out.push({ id: e.id + ":rdv", day: parisDay(e.event_at), at: e.event_at, kind: "rdv", title: `${e.event_kind === "webinaire" ? "Webinaire" : "Visio"} — ${d.titre}`, detail: step, tone: e.statut === "valide" ? "valide" : "en_cours", dossierId: d.id });
    if (e.lien_expire_at && e.statut !== "valide")
      out.push({ id: e.id + ":lien", day: parisDay(e.lien_expire_at), at: e.lien_expire_at, kind: "lien", title: `Expiration lien / code CDC — ${d.titre}`, detail: step, tone: parisDay(e.lien_expire_at) < today ? "refuse" : "bientot", dossierId: d.id });
  }
  for (const doc of documents) {
    const d = byId.get(doc.dossier_id);
    if (!d || !doc.date_peremption) continue;
    const st = docState(doc, today).state;
    out.push({ id: doc.id + ":per", day: doc.date_peremption, at: null, kind: "peremption", title: `Péremption : ${doc.nom}`, detail: d.titre, tone: st === "perime" ? "refuse" : st === "bientot" ? "bientot" : "a_faire", dossierId: d.id });
  }
  return out.sort((a, b) => (a.day + (a.at ?? "")).localeCompare(b.day + (b.at ?? "")));
}

// ---------- Export iCalendar ----------
const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const icsUtc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function buildIcs(events: CalEvent[]) {
  const stamp = icsUtc(new Date().toISOString());
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//IZISuivis//Pole Certification EDOF//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Pôle Certification & EDOF"];
  for (const ev of events) {
    lines.push("BEGIN:VEVENT", `UID:${ev.id.replace(/:/g, "-")}@izisuivis`, `DTSTAMP:${stamp}`);
    if (ev.at && (ev.kind === "rdv" || ev.kind === "lien")) {
      lines.push(`DTSTART:${icsUtc(ev.at)}`, `DTEND:${icsUtc(new Date(Date.parse(ev.at) + 3_600_000).toISOString())}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${ev.day.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${addDaysIso(ev.day, 1).replace(/-/g, "")}`);
    }
    lines.push(`SUMMARY:${icsEscape(`[${KIND_LABEL[ev.kind]}] ${ev.title}`)}`, `DESCRIPTION:${icsEscape(ev.detail)}`, `URL:${origin}/pole-certification/${ev.dossierId}`);
    if (ev.kind === "rdv") {
      for (const trigger of ["-P1D", "-PT1H"])
        lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:${trigger}`, `DESCRIPTION:${icsEscape(ev.title)}`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  // Pliage des lignes > 75 octets (RFC 5545) : approximation par caractères.
  return lines.map((l) => (l.length > 74 ? l.match(/.{1,74}/g)!.join("\r\n ") : l)).join("\r\n");
}

export function PcCalendar(props: PcViewProps) {
  const navigate = useNavigate();
  const today = todayIso();
  const [mode, setMode] = useState<"mois" | "semaine" | "jour">("mois");
  const [cursor, setCursor] = useState(today);
  const events = useMemo(() => buildEvents(props, today), [props, today]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const ev of events) m.set(ev.day, [...(m.get(ev.day) ?? []), ev]);
    return m;
  }, [events]);

  const open = (ev: CalEvent) => navigate({ to: "/pole-certification/$id", params: { id: ev.dossierId } });

  function shift(dir: 1 | -1) {
    if (mode === "jour") return setCursor(addDaysIso(cursor, dir));
    if (mode === "semaine") return setCursor(addDaysIso(cursor, 7 * dir));
    const d = new Date(cursor.slice(0, 7) + "-15T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + dir);
    setCursor(d.toISOString().slice(0, 7) + "-01");
  }

  function exportIcs() {
    const blob = new Blob([buildIcs(events)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pole-certification-edof-${today}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const title = mode === "mois"
    ? new Date(cursor.slice(0, 7) + "-15T12:00:00Z").toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
    : mode === "semaine"
      ? `Semaine du ${frDate(startOfWeek(cursor))} au ${frDate(addDaysIso(startOfWeek(cursor), 6))}`
      : new Date(cursor + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <Card className="p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Précédent" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(today)}>Aujourd'hui</Button>
          <Button variant="outline" size="icon" aria-label="Suivant" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <h2 className="font-medium capitalize">{title}</h2>
        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)} className="ml-auto">
          <TabsList>
            <TabsTrigger value="mois">Mois</TabsTrigger>
            <TabsTrigger value="semaine">Semaine</TabsTrigger>
            <TabsTrigger value="jour">Jour</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="outline" size="sm" onClick={exportIcs} title="Importer dans Google Agenda ou Outlook">
          <Download className="h-4 w-4 mr-1" /> Exporter (.ics)
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Le fichier .ics s'importe dans Google Agenda ou Outlook (rappels la veille et 1 h avant les visios et webinaires).</p>

      {mode === "mois" && <MonthGrid cursor={cursor} today={today} byDay={byDay} onOpen={open} onDay={(d) => { setCursor(d); setMode("jour"); }} />}
      {mode === "semaine" && (
        <div className="grid gap-2 md:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => addDaysIso(startOfWeek(cursor), i)).map((day) => (
            <div key={day} className={cn("rounded-md border p-2 min-h-[140px]", day === today && "ring-2 ring-gold")}>
              <button type="button" className="text-xs font-medium mb-1 hover:underline" onClick={() => { setCursor(day); setMode("jour"); }}>
                {WEEKDAYS[dow(day)]} {frDate(day).slice(0, 5)}
              </button>
              <div className="space-y-1">{(byDay.get(day) ?? []).map((ev) => <EventChip key={ev.id} ev={ev} onOpen={open} />)}</div>
            </div>
          ))}
        </div>
      )}
      {mode === "jour" && (
        <div className="space-y-2">
          {(byDay.get(cursor) ?? []).length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">Aucun événement ce jour.</p>}
          {(byDay.get(cursor) ?? []).map((ev) => <EventChip key={ev.id} ev={ev} onOpen={open} large />)}
        </div>
      )}
    </Card>
  );
}

function MonthGrid({ cursor, today, byDay, onOpen, onDay }: {
  cursor: string; today: string; byDay: Map<string, CalEvent[]>; onOpen: (e: CalEvent) => void; onDay: (d: string) => void;
}) {
  const first = cursor.slice(0, 7) + "-01";
  const start = startOfWeek(first);
  const month = cursor.slice(0, 7);
  const days = Array.from({ length: 42 }, (_, i) => addDaysIso(start, i));
  const weeks = days[35].slice(0, 7) === month ? 6 : 5;
  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-7 min-w-[700px] border-l border-t rounded-md">
        {WEEKDAYS.map((w) => <div key={w} className="border-r border-b px-2 py-1 text-xs font-medium text-muted-foreground bg-muted/40">{w}</div>)}
        {days.slice(0, weeks * 7).map((day) => {
          const evs = byDay.get(day) ?? [];
          return (
            <div key={day} className={cn("border-r border-b p-1 min-h-[96px]", day.slice(0, 7) !== month && "bg-muted/30 text-muted-foreground")}>
              <button type="button" onClick={() => onDay(day)}
                className={cn("text-xs tabular-nums rounded px-1 hover:bg-muted", day === today && "bg-gold text-gold-foreground font-semibold")}>
                {Number(day.slice(8))}
              </button>
              <div className="space-y-0.5 mt-0.5">
                {evs.slice(0, 3).map((ev) => <EventChip key={ev.id} ev={ev} onOpen={onOpen} />)}
                {evs.length > 3 && <button type="button" className="text-[11px] text-muted-foreground hover:underline" onClick={() => onDay(day)}>+ {evs.length - 3} autre(s)</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventChip({ ev, onOpen, large }: { ev: CalEvent; onOpen: (e: CalEvent) => void; large?: boolean }) {
  const t = PC_TONES[ev.tone];
  const Icon = KIND_ICON[ev.kind];
  return (
    <button type="button" onClick={() => onOpen(ev)} title={`${KIND_LABEL[ev.kind]} · ${t.label} — ${ev.title} — ${ev.detail}`}
      className={cn("w-full text-left rounded border border-l-4 px-1.5 py-0.5 hover:brightness-95", t.badge, large ? "text-sm py-2" : "text-[11px]")}
      style={{ borderLeftColor: t.hex }}>
      <span className="flex items-center gap-1 min-w-0">
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
        {ev.at && <span className="tabular-nums shrink-0">{parisTime(ev.at)}</span>}
        <span className="truncate">{ev.title}</span>
      </span>
      {large && <span className="block text-xs opacity-80 mt-0.5">{KIND_LABEL[ev.kind]} · {t.label} · {ev.detail}</span>}
    </button>
  );
}

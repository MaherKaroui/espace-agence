import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { AlertTriangle, CalendarClock, FileWarning, FolderOpen, Hourglass, XCircle, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  addDaysIso, currentEtapes, docState, dossierState, etapeTone, frDate, frDateTime, personName, todayIso,
  DOC_STATE_UI, type PcDossier,
} from "@/lib/pole-certification";
import { PcStatusBadge } from "./pc-status";
import type { PcViewProps } from "./pc-view-types";

export type { PcViewProps } from "./pc-view-types";

/** Dimanche de la semaine en cours (semaine du lundi au dimanche). */
function endOfWeek(today: string) {
  const dow = new Date(today + "T12:00:00Z").getUTCDay(); // 0 = dimanche
  return addDaysIso(today, dow === 0 ? 0 : 7 - dow);
}

interface TodoItem { key: string; dossier: PcDossier; date: string; label: string; detail: string; tone: Parameters<typeof PcStatusBadge>[0]["tone"]; responsable: string }

export function PcDashboard({ dossiers, etapes, documents, profiles }: PcViewProps) {
  const today = todayIso();
  const weekEnd = endOfWeek(today);
  const month = today.slice(0, 7);

  const data = useMemo(() => {
    const actifs = dossiers.filter((d) => !d.archived_at);
    const ids = new Set(actifs.map((d) => d.id));
    const states = new Map(actifs.map((d) => [d.id, dossierState(d, etapes, documents, today)]));
    const byId = new Map(actifs.map((d) => [d.id, d]));

    const enCours = actifs.filter((d) => states.get(d.id)!.statut !== "termine").length;
    const enAttente = actifs.filter((d) => states.get(d.id)!.statut === "en_attente").length;
    const refuses = actifs.filter((d) => ["refuse", "recours"].includes(states.get(d.id)!.statut)).length;
    const validesMois = etapes.filter((e) => ids.has(e.dossier_id) && e.statut === "valide" && e.date_realisation?.startsWith(month)).length;

    // À faire aujourd'hui / cette semaine (échéances, RDV, expirations de lien CDC)
    const todo: TodoItem[] = [];
    for (const e of currentEtapes(etapes.filter((x) => ids.has(x.dossier_id)))) {
      if (e.statut === "valide") continue;
      const d = byId.get(e.dossier_id)!;
      const resp = e.responsable_id ?? d.responsable_id;
      const label = `Étape ${e.ordre} — ${e.intitule}`;
      if (e.date_echeance && e.date_echeance <= weekEnd)
        todo.push({ key: e.id + "ech", dossier: d, date: e.date_echeance, label, detail: `Échéance ${frDate(e.date_echeance)}`, tone: etapeTone(e, today), responsable: resp });
      const ev = e.event_at?.slice(0, 10);
      if (ev && ev >= today && ev <= weekEnd)
        todo.push({ key: e.id + "ev", dossier: d, date: ev, label, detail: `${e.event_kind === "webinaire" ? "Webinaire" : "Visio"} ${frDateTime(e.event_at)}`, tone: "en_cours", responsable: resp });
      const lien = e.lien_expire_at?.slice(0, 10);
      if (lien && lien <= weekEnd)
        todo.push({ key: e.id + "lien", dossier: d, date: lien, label, detail: `Lien / code CDC expire le ${frDateTime(e.lien_expire_at)}`, tone: lien < today ? "refuse" : "bientot", responsable: resp });
    }
    todo.sort((a, b) => a.date.localeCompare(b.date));
    const todoByResp = new Map<string, TodoItem[]>();
    for (const t of todo) todoByResp.set(t.responsable, [...(todoByResp.get(t.responsable) ?? []), t]);

    const docsAlerte = documents
      .filter((x) => ids.has(x.dossier_id))
      .map((x) => ({ doc: x, ...docState(x, today) }))
      .filter((x) => x.state === "bientot" || x.state === "perime")
      .sort((a, b) => (a.joursRestants ?? 0) - (b.joursRestants ?? 0));

    const retards = actifs.filter((d) => states.get(d.id)!.enRetard);
    return { enCours, enAttente, refuses, validesMois, todoByResp, todoCount: todo.length, docsAlerte, retards, states, byId };
  }, [dossiers, etapes, documents, today, weekEnd, month]);

  const counters = [
    { label: "Dossiers en cours", value: data.enCours, icon: FolderOpen, cls: "text-blue-600 dark:text-blue-400" },
    { label: "En attente de réponse", value: data.enAttente, icon: Hourglass, cls: "text-yellow-600 dark:text-yellow-300" },
    { label: "Refusés / en recours", value: data.refuses, icon: XCircle, cls: "text-red-600 dark:text-red-400" },
    { label: "Étapes validées ce mois-ci", value: data.validesMois, icon: CheckCircle2, cls: "text-green-600 dark:text-green-400" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {counters.map((c) => (
          <Card key={c.label} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <c.icon className={`h-4 w-4 ${c.cls}`} aria-hidden />
            </div>
            <p className="text-3xl font-semibold mt-1 tabular-nums">{c.value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 space-y-3">
          <h2 className="font-medium flex items-center gap-2"><CalendarClock className="h-4 w-4" /> À faire aujourd'hui / cette semaine <span className="text-muted-foreground text-sm">({data.todoCount})</span></h2>
          {data.todoCount === 0 ? (
            <p className="text-sm text-muted-foreground">Rien de prévu d'ici dimanche.</p>
          ) : (
            [...data.todoByResp.entries()].map(([resp, items]) => (
              <div key={resp} className="space-y-1.5">
                <p className="text-xs uppercase tracking-wider text-gold">{personName(profiles.get(resp))}</p>
                <ul className="space-y-1.5">
                  {items.map((t) => (
                    <li key={t.key}>
                      <Link to="/pole-certification/$id" params={{ id: t.dossier.id }} className="flex flex-wrap items-center gap-2 rounded-md border p-2 hover:bg-muted/50">
                        <span className={`text-xs font-medium tabular-nums ${t.date === today ? "text-gold" : "text-muted-foreground"}`}>{t.date === today ? "Aujourd'hui" : frDate(t.date)}</span>
                        <span className="text-sm font-medium truncate">{t.dossier.titre}</span>
                        <span className="text-xs text-muted-foreground w-full sm:w-auto truncate">{t.label} · {t.detail}</span>
                        <PcStatusBadge tone={t.tone} className="ml-auto" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </Card>

        <Card className="p-4 space-y-3">
          <h2 className="font-medium flex items-center gap-2"><FileWarning className="h-4 w-4" /> Documents qui expirent bientôt <span className="text-muted-foreground text-sm">({data.docsAlerte.length})</span></h2>
          {data.docsAlerte.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune pièce périmée ou à moins de 15 jours de péremption.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.docsAlerte.map(({ doc, state, joursRestants }) => {
                const d = data.byId.get(doc.dossier_id)!;
                return (
                  <li key={doc.id}>
                    <Link to="/pole-certification/$id" params={{ id: d.id }} className="flex flex-wrap items-center gap-2 rounded-md border p-2 hover:bg-muted/50">
                      <span className="text-sm font-medium">{doc.nom}</span>
                      <span className="text-xs text-muted-foreground truncate">{d.titre} · péremption {frDate(doc.date_peremption)}</span>
                      <span className="ml-auto flex items-center gap-2">
                        <span className="text-xs tabular-nums">{state === "perime" ? `périmé depuis ${-(joursRestants ?? 0)} j` : `${joursRestants} j restants`}</span>
                        <PcStatusBadge tone={DOC_STATE_UI[state].tone} label={DOC_STATE_UI[state].label} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4 space-y-3 border-red-500/40">
        <h2 className="font-medium flex items-center gap-2 text-red-700 dark:text-red-300"><AlertTriangle className="h-4 w-4" /> Dossiers en retard <span className="text-sm">({data.retards.length})</span></h2>
        {data.retards.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune échéance dépassée.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {data.retards.map((d) => {
              const s = data.states.get(d.id)!;
              return (
                <li key={d.id}>
                  <Link to="/pole-certification/$id" params={{ id: d.id }} className="block rounded-md border border-red-500/40 bg-red-500/10 p-2 hover:bg-red-500/15">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{d.titre}</span>
                      <PcStatusBadge tone="retard" className="ml-auto" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {s.etapeCourante ? `Étape ${s.etapeCourante.ordre} — ${s.etapeCourante.intitule}` : "—"} · {personName(profiles.get(d.responsable_id))}
                      {s.prochaineEcheance && ` · échéance ${frDate(s.prochaineEcheance)}`}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

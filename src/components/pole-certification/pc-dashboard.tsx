import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
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

/** `onPickStatut` : un clic sur un compteur ouvre le tableau filtré sur ce statut. */
export function PcDashboard({ dossiers, etapes, documents, profiles, onPickStatut }: PcViewProps & { onPickStatut?: (statut: string) => void }) {
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
    { label: "Dossiers en cours", value: data.enCours, statut: "all" },
    { label: "En attente de réponse", value: data.enAttente, statut: "en_attente" },
    { label: "Refusés ou en recours", value: data.refuses, statut: "refuse" },
    { label: "Étapes validées ce mois-ci", value: data.validesMois, statut: null },
  ];
  const row = "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-2 -mx-2 hover:bg-muted/60 active:bg-muted transition-colors";

  return (
    <div className="space-y-4">
      <Card className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 overflow-hidden p-0">
        {counters.map((c) => {
          const body = (
            <>
              <span className="block text-3xl font-semibold tabular-nums tracking-tight">{c.value}</span>
              <span className="block text-sm text-muted-foreground mt-0.5">{c.label}</span>
            </>
          );
          return c.statut && onPickStatut ? (
            <button key={c.label} type="button" onClick={() => onPickStatut(c.statut!)}
              className="text-left p-4 hover:bg-muted/50 active:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
              {body}
            </button>
          ) : (
            <div key={c.label} className="p-4">{body}</div>
          );
        })}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 space-y-3">
          <h2 className="font-medium">À faire cette semaine <span className="text-muted-foreground font-normal tabular-nums">{data.todoCount}</span></h2>
          {data.todoCount === 0 ? (
            <p className="text-sm text-muted-foreground">Rien de prévu d'ici dimanche : aucune échéance, visio ou expiration de lien.</p>
          ) : (
            [...data.todoByResp.entries()].map(([resp, items]) => (
              <div key={resp} className="space-y-1.5">
                <p className="text-sm font-medium text-muted-foreground">{personName(profiles.get(resp))}</p>
                <ul className="space-y-1.5">
                  {items.map((t) => (
                    <li key={t.key}>
                      <Link to="/pole-certification/$id" params={{ id: t.dossier.id }} className={row}>
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
          <h2 className="font-medium">Documents qui expirent bientôt <span className="text-muted-foreground font-normal tabular-nums">{data.docsAlerte.length}</span></h2>
          {data.docsAlerte.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune pièce périmée ou à moins de 15 jours de péremption.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.docsAlerte.map(({ doc, state, joursRestants }) => {
                const d = data.byId.get(doc.dossier_id)!;
                return (
                  <li key={doc.id}>
                    <Link to="/pole-certification/$id" params={{ id: d.id }} className={row}>
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

      <Card className={`p-4 space-y-3 ${data.retards.length ? "border-red-500/40" : ""}`}>
        <h2 className={`font-medium flex items-center gap-2 ${data.retards.length ? "text-red-700 dark:text-red-300" : ""}`}>
          {data.retards.length > 0 && <AlertTriangle className="h-4 w-4" aria-hidden />}
          Dossiers en retard <span className="font-normal tabular-nums opacity-70">{data.retards.length}</span>
        </h2>
        {data.retards.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune échéance dépassée.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {data.retards.map((d) => {
              const s = data.states.get(d.id)!;
              return (
                <li key={d.id}>
                  <Link to="/pole-certification/$id" params={{ id: d.id }} className="block rounded-md border border-red-500/30 bg-red-500/5 p-2 hover:bg-red-500/10 active:bg-red-500/15 transition-colors">
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

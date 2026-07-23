import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer, Download } from "lucide-react";
import { listQualiopiRequests } from "@/lib/qualiopi.functions";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/audits/$id_/qualiopi-rapport")({
  head: () => ({ meta: [{ title: "Rapport Qualiopi — IZISuivis" }] }),
  component: QualiopiReport,
});

const STATUT_LABEL: Record<string, string> = {
  en_attente: "En attente",
  deposee: "Déposée",
  validee: "Validée",
  refusee: "Refusée",
};

const ACTION_LABEL: Record<string, string> = {
  created: "Demande créée",
  document_uploaded: "Document déposé",
  validated: "Pièce validée",
  refused: "Pièce refusée",
  reminder_sent: "Relance envoyée",
};

function QualiopiReport() {
  const { id } = Route.useParams();
  const listFn = useServerFn(listQualiopiRequests);

  const { data: dossier } = useQuery({
    queryKey: ["dossier-report", id],
    queryFn: async () => {
      const { data } = await supabase.from("dossiers").select("*").eq("id", id).maybeSingle();
      return data;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["qualiopi-requests", id],
    queryFn: () => listFn({ data: { dossierId: id } }),
  });

  const requests = (data?.requests ?? []) as any[];
  const documents = (data?.documents ?? []) as any[];
  const events = (data?.events ?? []) as any[];
  const indicators = (data?.indicators ?? []) as any[];
  const criteria = (data?.criteria ?? []) as any[];
  const profiles = (data?.profiles ?? []) as any[];

  const nameOf = (uid: string | null) => {
    if (!uid) return "Système";
    const p = profiles.find((x) => x.id === uid);
    return p ? `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email : uid.slice(0, 8);
  };

  const exportCsv = () => {
    const rows: string[][] = [
      ["Critère", "Indicateur", "Statut", "Échéance", "Demandé par", "Message", "Motif de refus", "Documents (versions)", "Dernière relance"],
    ];
    for (const r of requests) {
      const ind = indicators.find((i) => i.id === r.indicator_id);
      const crit = ind ? criteria.find((c) => c.id === ind.criterion_id) : null;
      const docs = documents.filter((d) => d.request_id === r.id);
      const docsStr = docs
        .sort((a, b) => a.version - b.version)
        .map((d) => `v${d.version} ${d.filename}`)
        .join(" | ");
      rows.push([
        crit ? `C${crit.id} ${crit.titre}` : "",
        ind ? `Ind. ${ind.numero} ${ind.libelle_court}` : String(r.indicator_id),
        STATUT_LABEL[r.statut] ?? r.statut,
        r.due_date ? format(new Date(r.due_date), "dd/MM/yyyy") : "",
        nameOf(r.requested_by),
        (r.message ?? "").replace(/\n/g, " "),
        (r.refus_motif ?? "").replace(/\n/g, " "),
        docsStr,
        r.last_reminder_at ? format(new Date(r.last_reminder_at), "dd/MM/yyyy HH:mm") : "",
      ]);
    }
    const csv = rows
      .map((r) => r.map((c) => `"${(c ?? "").toString().replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qualiopi-${(dossier as any)?.organisme_nom || id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <p className="text-sm text-muted-foreground p-6">Chargement…</p>;

  return (
    <div className="max-w-4xl mx-auto p-4 print:p-0 space-y-4 print:space-y-2">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link to="/audits/$id" params={{ id }} className="text-sm text-muted-foreground flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Retour au dossier
        </Link>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" /> Imprimer / PDF
          </Button>
        </div>
      </div>

      <div className="border-b pb-3 print:pb-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Rapport Qualiopi</div>
        <h1 className="text-2xl font-display">{(dossier as any)?.titre ?? "Dossier"}</h1>
        <div className="text-sm text-muted-foreground mt-1">
          {(dossier as any)?.organisme_nom && <>Organisme : {(dossier as any).organisme_nom} · </>}
          Édité le {format(new Date(), "d MMMM yyyy 'à' HH:mm", { locale: fr })}
        </div>
      </div>

      <div className="text-sm">
        <div className="grid grid-cols-4 gap-2 mb-3 print:mb-2">
          {(["en_attente", "deposee", "validee", "refusee"] as const).map((s) => {
            const n = requests.filter((r) => r.statut === s).length;
            return (
              <div key={s} className="border rounded p-2 print:p-1 text-center">
                <div className="text-[10px] uppercase text-muted-foreground">{STATUT_LABEL[s]}</div>
                <div className="text-lg font-medium">{n}</div>
              </div>
            );
          })}
        </div>
      </div>

      {requests.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucune demande Qualiopi enregistrée.</p>
      )}

      <div className="space-y-3 print:space-y-2">
        {criteria.map((crit) => {
          const critIndicators = indicators.filter((i) => i.criterion_id === crit.id);
          const critRequests = requests.filter((r) => critIndicators.some((i) => i.id === r.indicator_id));
          if (critRequests.length === 0) return null;
          return (
            <section key={crit.id} className="break-inside-avoid">
              <h2 className="text-sm font-medium uppercase tracking-wider bg-muted/50 px-2 py-1 rounded">
                Critère {crit.id} — {crit.titre}
              </h2>
              <div className="mt-2 space-y-2">
                {critRequests.map((r) => {
                  const ind = indicators.find((i) => i.id === r.indicator_id);
                  const docs = documents
                    .filter((d) => d.request_id === r.id)
                    .sort((a, b) => a.version - b.version);
                  const evts = events
                    .filter((e) => e.request_id === r.id)
                    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                  return (
                    <div key={r.id} className="border rounded p-2 print:p-1.5 text-xs break-inside-avoid">
                      <div className="flex flex-wrap justify-between gap-2 mb-1">
                        <div className="font-medium text-sm">
                          Ind. {ind?.numero} — {ind?.libelle_court}
                        </div>
                        <div className="text-[11px]">
                          Statut : <span className="font-medium">{STATUT_LABEL[r.statut] ?? r.statut}</span>
                          {r.due_date && <> · Échéance {format(new Date(r.due_date), "dd/MM/yyyy")}</>}
                        </div>
                      </div>
                      {r.message && <p className="whitespace-pre-wrap text-muted-foreground">{r.message}</p>}
                      {r.refus_motif && (
                        <p className="mt-1 border-l-2 border-destructive pl-2">
                          <span className="font-medium">Motif de refus : </span>
                          {r.refus_motif}
                        </p>
                      )}
                      {docs.length > 0 && (
                        <div className="mt-1">
                          <div className="font-medium text-[11px]">Documents :</div>
                          <ul className="list-disc pl-4">
                            {docs.map((d) => (
                              <li key={d.id}>
                                v{d.version} · {d.filename} · {nameOf(d.uploaded_by)} ·{" "}
                                {format(new Date(d.created_at), "dd/MM/yyyy HH:mm")}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {evts.length > 0 && (
                        <div className="mt-1">
                          <div className="font-medium text-[11px]">Historique :</div>
                          <ul className="list-disc pl-4">
                            {evts.map((e) => (
                              <li key={e.id}>
                                {format(new Date(e.created_at), "dd/MM/yyyy HH:mm")} · {ACTION_LABEL[e.action] ?? e.action} · {nameOf(e.actor_id)}
                                {e.meta?.motif && ` — Motif : ${e.meta.motif}`}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

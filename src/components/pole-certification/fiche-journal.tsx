import { useQuery } from "@tanstack/react-query";
import { FileDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  PC_ACTIONS, PC_TONES, frDate, frDateTime, pcTypeLabel, personName,
  type PcEvenement, type PcProfile, type PcStatut,
} from "@/lib/pole-certification";
import { PcStatusBadge } from "./pc-status";
import { usePcProfiles } from "./use-pc";
import type { FicheCtx } from "./fiche-context";

const FIELD_LABELS: Record<string, string> = {
  titre: "Titre", organisme: "Organisme", certificateur: "Certificateur", code_rs: "Code RS", date_cible: "Date cible",
  notes: "Champ libre", intitule: "Intitulé", ordre: "Numéro", date_debut: "Début", date_echeance: "Échéance",
  date_realisation: "Réalisation", date_limite_recours: "Limite de recours", event_at: "Date du RDV",
  lien_expire_at: "Expiration du lien", motif_refus: "Motif du refus", responsable: "Responsable",
  date_emission: "Date d'émission", validite_jours: "Validité (jours)", checklist: "Cases cochées",
};

const fmtVal = (v: any, profiles: Map<string, PcProfile>): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && /^[0-9a-f-]{36}$/.test(v)) return personName(profiles.get(v));
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return frDate(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return frDateTime(v);
  if (typeof v === "object") return Object.entries(v).filter(([, x]) => x).map(([k]) => k).join(", ") || "aucune";
  return String(v);
};

const statutLabel = (s: string) => PC_TONES[s as PcStatut]?.label ?? s;

/** Résumé texte d'un événement (affichage + export PDF). */
function summarize(ev: PcEvenement, profiles: Map<string, PcProfile>): string {
  const d = ev.details ?? {};
  const etape = d.intitule ?? d._intitule;
  const prefix = etape ? `Étape ${d.ordre ?? d._ordre} — ${etape}` : "";
  switch (ev.action) {
    case "etape.statut":
      return `${prefix} : ${statutLabel(d.ancien)} → ${statutLabel(d.nouveau)}${d.tentative > 1 ? ` (tentative ${d.tentative})` : ""}${d.nouveau === "refuse" && d.motif ? ` — motif : ${d.motif}` : ""}`;
    case "dossier.responsable":
      return `${fmtVal(d.ancien, profiles)} → ${fmtVal(d.nouveau, profiles)}`;
    case "etape.forcage":
      return `Motif : ${d.motif ?? "—"}`;
    case "rappel.reporte":
      return `${prefix || d.piece || ""} jusqu'au ${fmtVal(d.jusqua, profiles)}`;
    case "membre.ajoute":
    case "membre.retire":
      return `${fmtVal(d.user, profiles)}${d.role ? ` (${d.role === "lecture" ? "lecture seule" : "collaborateur"})` : ""}`;
    case "etape.fichier":
    case "piece.version":
      return `${d.fichier ?? ""}${d.version ? ` (v${d.version})` : ""}`;
    case "dossier.cree":
      return `${d.type ? pcTypeLabel(d.type) : ""} — ${d.titre ?? ""}`;
    case "piece.ajoutee":
    case "piece.supprimee":
      return d.nom ?? "";
    default: {
      const changes = Object.entries(d)
        .filter(([k]) => !k.startsWith("_") && k !== "nom" && k !== "ordre" && k !== "intitule" && k !== "tentative")
        .map(([k, v]) => Array.isArray(v) ? `${FIELD_LABELS[k] ?? k} : ${fmtVal(v[0], profiles)} → ${fmtVal(v[1], profiles)}` : `${FIELD_LABELS[k] ?? k} : ${fmtVal(v, profiles)}`);
      return [prefix || d.nom, ...changes].filter(Boolean).join(" · ");
    }
  }
}

export function FicheJournal({ ctx }: { ctx: FicheCtx }) {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["pc-dossier", ctx.dossier.id, "journal"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("pc_evenements").select("*")
        .eq("dossier_id", ctx.dossier.id).order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PcEvenement[];
    },
  });
  const ids = events.flatMap((e) => [e.actor_id ?? "", ...Object.values(e.details ?? {}).flat().filter((v) => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v)) as string[]]);
  const extra = usePcProfiles(ids);
  const profiles = new Map([...ctx.profiles, ...extra]);

  const exportPdf = async () => {
    const { default: jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF();
    const d = ctx.dossier;
    doc.setFontSize(14);
    doc.text(`Historique — ${d.titre}`, 14, 15);
    doc.setFontSize(9);
    doc.text(`${pcTypeLabel(d.type)} · Organisme : ${d.organisme ?? "—"} · Certificateur : ${d.certificateur ?? "—"} · Responsable : ${personName(profiles.get(d.responsable_id))}`, 14, 22);
    doc.text(`Créé le ${frDate(d.created_at)} · Export du ${frDateTime(new Date().toISOString())}`, 14, 27);
    autoTable(doc, {
      startY: 32,
      head: [["Date", "Auteur", "Action", "Détail"]],
      body: events.map((e) => [frDateTime(e.created_at), e.actor_id ? personName(profiles.get(e.actor_id)) : "Système", PC_ACTIONS[e.action] ?? e.action, summarize(e, profiles)]),
      styles: { fontSize: 8, cellWidth: "wrap" },
      columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 30 }, 2: { cellWidth: 35 } },
    });
    doc.save(`historique-${d.titre.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Toute action est horodatée et attribuée. Les refus et recours ne sont jamais effacés.</p>
        <Button size="sm" variant="outline" onClick={exportPdf} disabled={events.length === 0}><FileDown className="h-4 w-4 mr-1" /> Exporter en PDF</Button>
      </div>
      <Card className="p-0 divide-y">
        {isLoading ? <p className="p-4 text-sm text-muted-foreground">Chargement…</p>
          : events.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Aucun événement.</p>
          : [...events].reverse().map((e) => (
            <div key={e.id} className="p-3 text-sm flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
              <span className="text-xs text-muted-foreground tabular-nums sm:w-36 shrink-0">{frDateTime(e.created_at)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{PC_ACTIONS[e.action] ?? e.action}</span>
                  {e.action === "etape.statut" && e.details?.nouveau && <PcStatusBadge tone={e.details.nouveau as PcStatut} />}
                  <span className="text-xs text-muted-foreground">par {e.actor_id ? personName(profiles.get(e.actor_id)) : "le système"}</span>
                </div>
                <p className="text-muted-foreground break-words whitespace-pre-wrap">{summarize(e, profiles)}</p>
              </div>
            </div>
          ))}
      </Card>
    </div>
  );
}

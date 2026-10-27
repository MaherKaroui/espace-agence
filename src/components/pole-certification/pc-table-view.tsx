import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { ArrowDown, ArrowUp, ArrowUpDown, FileDown, FileSpreadsheet, Search } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  dossierState, frDate, frDateTime, pcTypeLabel, personName, todayIso, PC_TONES, type PcTone,
} from "@/lib/pole-certification";
import { PcStatusBadge } from "./pc-status";
import type { PcViewProps } from "./pc-view-types";

interface Row {
  id: string;
  type: string;
  titre: string;
  certificateur: string;
  responsable: string;
  etape: string;
  statut: string;
  tone: PcTone;
  echeance: string;     // ISO pour le tri
  perimes: string;      // Oui / Non
  creation: string;     // ISO
  derniere: string;     // ISO datetime
}

type Col = { key: keyof Row; label: string; fmt?: (r: Row) => string };
const COLS: Col[] = [
  { key: "type", label: "Type" },
  { key: "titre", label: "Certification / organisme" },
  { key: "certificateur", label: "Certificateur" },
  { key: "responsable", label: "Responsable du dossier" },
  { key: "etape", label: "Étape actuelle" },
  { key: "statut", label: "Statut" },
  { key: "echeance", label: "Prochaine échéance", fmt: (r) => (r.echeance ? frDate(r.echeance) : "—") },
  { key: "perimes", label: "Documents périmés" },
  { key: "creation", label: "Création", fmt: (r) => frDate(r.creation) },
  { key: "derniere", label: "Dernière action", fmt: (r) => frDateTime(r.derniere) },
];
const display = (c: Col, r: Row) => (c.fmt ? c.fmt(r) : String(r[c.key] ?? "")) || "—";

export function PcTableView({ dossiers, etapes, documents, profiles }: PcViewProps) {
  const [search, setSearch] = useState("");
  const [colFilters, setColFilters] = useState<Partial<Record<keyof Row, string>>>({});
  const [sort, setSort] = useState<{ key: keyof Row; dir: 1 | -1 }>({ key: "echeance", dir: 1 });

  const rows = useMemo<Row[]>(() => {
    const today = todayIso();
    return dossiers.map((d) => {
      const s = dossierState(d, etapes, documents, today);
      const last = etapes.filter((e) => e.dossier_id === d.id).reduce((m, e) => (e.updated_at > m ? e.updated_at : m), d.updated_at);
      return {
        id: d.id,
        type: pcTypeLabel(d.type),
        titre: d.titre,
        certificateur: d.certificateur ?? "",
        responsable: personName(profiles.get(d.responsable_id)),
        etape: s.etapeCourante ? `${s.etapeCourante.ordre}. ${s.etapeCourante.intitule}${s.tentatives > 1 ? ` (tentative ${s.tentatives})` : ""}` : "Parcours terminé",
        statut: PC_TONES[s.tone].label,
        tone: s.tone,
        echeance: s.prochaineEcheance ?? "",
        perimes: s.docsPerimes ? "Oui" : "Non",
        creation: d.created_at,
        derniere: last,
      };
    });
  }, [dossiers, etapes, documents, profiles]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (q && !COLS.some((c) => display(c, r).toLowerCase().includes(q))) return false;
      return COLS.every((c) => {
        const f = colFilters[c.key]?.trim().toLowerCase();
        return !f || display(c, r).toLowerCase().includes(f);
      });
    });
    return out.sort((a, b) => {
      const va = String(a[sort.key] ?? ""), vb = String(b[sort.key] ?? "");
      if (!va && vb) return 1; // valeurs vides en bas
      if (va && !vb) return -1;
      return va.localeCompare(vb, "fr", { numeric: true }) * sort.dir;
    });
  }, [rows, search, colFilters, sort]);

  const toggleSort = (key: keyof Row) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const stamp = todayIso();

  function exportXlsx() {
    const aoa = [COLS.map((c) => c.label), ...visible.map((r) => COLS.map((c) => display(c, r)))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = COLS.map((c) => ({ wch: Math.max(c.label.length, 14) + (c.key === "titre" || c.key === "etape" ? 16 : 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dossiers");
    XLSX.writeFile(wb, `Pole_Certification_EDOF_${stamp}.xlsx`);
  }

  async function exportPdf() {
    try {
      const { default: jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      doc.setFontSize(14);
      doc.text("Pôle Certification & EDOF — dossiers", 14, 14);
      doc.setFontSize(9);
      doc.text(`Export du ${frDate(stamp)} — ${visible.length} dossier(s)`, 14, 20);
      const statutCol = COLS.findIndex((c) => c.key === "statut");
      autoTable(doc, {
        startY: 24,
        head: [COLS.map((c) => c.label)],
        body: visible.map((r) => COLS.map((c) => display(c, r))),
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [15, 23, 42] },
        didParseCell: (h: any) => {
          if (h.section !== "body") return;
          const r = visible[h.row.index];
          if (h.column.index === statutCol) {
            h.cell.styles.fillColor = PC_TONES[r.tone].hex;
            h.cell.styles.textColor = r.tone === "en_attente" ? [30, 30, 30] : [255, 255, 255];
          }
          if (h.column.index === COLS.findIndex((c) => c.key === "perimes") && r.perimes === "Oui") h.cell.styles.textColor = [220, 38, 38];
        },
      });
      doc.save(`Pole_Certification_EDOF_${stamp}.pdf`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export PDF impossible");
    }
  }

  return (
    <Card className="p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input className="pl-8" placeholder="Rechercher dans toutes les colonnes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <span className="text-xs text-muted-foreground">{visible.length} / {rows.length} dossier(s)</span>
        <Button variant="outline" size="sm" onClick={exportXlsx}><FileSpreadsheet className="h-4 w-4 mr-1" /> Excel</Button>
        <Button variant="outline" size="sm" onClick={exportPdf}><FileDown className="h-4 w-4 mr-1" /> PDF</Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm min-w-[1100px]">
          <thead className="bg-muted/50">
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className="text-left font-medium px-2 py-2 whitespace-nowrap">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(c.key)}
                    aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                    {c.label}
                    {sort.key === c.key ? (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                  </button>
                </th>
              ))}
            </tr>
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className="px-1 pb-1">
                  <Input className="h-7 text-xs" placeholder="Filtrer" aria-label={`Filtrer ${c.label}`}
                    value={colFilters[c.key] ?? ""} onChange={(e) => setColFilters((f) => ({ ...f, [c.key]: e.target.value }))} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={COLS.length} className="text-center text-muted-foreground py-6">Aucun dossier.</td></tr>
            )}
            {visible.map((r) => (
              <tr key={r.id} className={cn("border-t hover:bg-muted/40", PC_TONES[r.tone].cell)}>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.type}</td>
                <td className="px-2 py-1.5 font-medium">
                  <Link to="/pole-certification/$id" params={{ id: r.id }} className="hover:underline">{r.titre}</Link>
                </td>
                <td className="px-2 py-1.5">{r.certificateur || "—"}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.responsable}</td>
                <td className="px-2 py-1.5">{r.etape}</td>
                <td className="px-2 py-1.5"><PcStatusBadge tone={r.tone} /></td>
                <td className={cn("px-2 py-1.5 whitespace-nowrap tabular-nums", r.tone === "retard" && "text-red-700 dark:text-red-300 font-medium")}>{r.echeance ? frDate(r.echeance) : "—"}</td>
                <td className="px-2 py-1.5">{r.perimes === "Oui" ? <PcStatusBadge tone="refuse" label="Oui" /> : "Non"}</td>
                <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{frDate(r.creation)}</td>
                <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{frDateTime(r.derniere)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

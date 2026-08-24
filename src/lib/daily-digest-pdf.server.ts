import type { DailyDigest } from "@/lib/daily-activity-report.server";

/**
 * Génération du PDF du compte rendu quotidien — version condensée (2 à 4 pages).
 * Aucune requête base : tout provient de l'objet DailyDigest déjà en mémoire.
 */

const NAVY: [number, number, number] = [18, 39, 71];
const NAVY_SOFT: [number, number, number] = [42, 68, 106];
const GOLD: [number, number, number] = [176, 141, 62];
const GREY: [number, number, number] = [110, 118, 130];
const LIGHT: [number, number, number] = [244, 246, 249];
const WARN_BG: [number, number, number] = [253, 240, 224];
const DANGER_BG: [number, number, number] = [253, 232, 232];

const M = 15; // marge mm
const MAX_ROWS = 24;

function cap<T>(rows: T[], max = MAX_ROWS): { rows: T[]; extra: number } {
  if (rows.length <= max) return { rows, extra: 0 };
  return { rows: rows.slice(0, max), extra: rows.length - max };
}

function txt(v: unknown, fallback = "—"): string {
  const s = v === null || v === undefined ? "" : String(v);
  return s.trim() === "" ? fallback : s;
}

export async function buildDailyDigestPdf(digest: DailyDigest): Promise<Uint8Array> {
  const t0 = Date.now();
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable: any = (autoTableMod as any).default ?? autoTableMod;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const contentW = W - M * 2;

  // jsPDF helvetica encode en WinAnsi : les accents latins passent tels quels.
  doc.setFont("helvetica", "normal");

  let y = M;

  const ensure = (needed: number) => {
    if (y + needed > H - 18) {
      doc.addPage();
      y = M + 6;
    }
  };

  const table = (opts: Record<string, unknown>) => {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M, top: M + 6, bottom: 18 },
      theme: "grid",
      rowPageBreak: "avoid",
      styles: { font: "helvetica", fontSize: 7.4, cellPadding: 1.1, textColor: [40, 46, 56], overflow: "linebreak" },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.4, cellPadding: 1.2 },
      alternateRowStyles: { fillColor: LIGHT },
      ...opts,
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 4;
  };

  const sectionTitle = (label: string) => {
    ensure(11);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...NAVY_SOFT);
    doc.text(label.toUpperCase(), M, y);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.5);
    doc.line(M, y + 2.2, M + 16, y + 2.2);
    y += 6;
    doc.setTextColor(40, 46, 56);
  };

  const body = (line: string, indent = 0, size = 8) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(line, contentW - indent) as string[];
    for (const l of lines) {
      ensure(5);
      doc.text(l, M + indent, y);
      y += 4;
    }
  };

  // ---------- Page 1 : vue d'ensemble ----------
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Compte rendu quotidien", M, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(txt(digest.dateFr, ""), M, 21);
  doc.setFontSize(7.5);
  doc.setTextColor(214, 199, 160);
  doc.text(`Période couverte : ${txt(digest.periode, "journée")}`, M, 26.5);
  doc.setTextColor(40, 46, 56);
  y = 37;

  const s = digest.synthese;
  sectionTitle("Synthèse de l'équipe");
  table({
    head: [["Indicateur", "Valeur", "Indicateur", "Valeur"]],
    body: [
      ["Personnes connectées", `${s.connectes} / ${s.equipe}`, "Temps de connexion cumulé", txt(s.tempsCumule, "0 min")],
      ["Tâches terminées", String(s.tachesTerminees), "Tâches en cours", String(s.tachesEnCours)],
      ["Tâches en retard", String(s.tachesEnRetard), "Dossiers créés", String(s.dossiersCrees)],
      ["Changements de statut", String(s.changementsStatut), "Documents déposés", String(s.documentsDeposes)],
      ["Messages échangés", String(s.messages), "Nouveaux clients", String(s.nouveauxClients)],
    ],
    columnStyles: {
      0: { cellWidth: contentW * 0.3, fontStyle: "bold" },
      1: { cellWidth: contentW * 0.2 },
      2: { cellWidth: contentW * 0.3, fontStyle: "bold" },
      3: { cellWidth: contentW * 0.2 },
    },
  });

  sectionTitle("Récapitulatif de l'équipe");
  table({
    head: [["Nom", "Rôle", "Connexion", "Terminées", "En cours", "En retard", "Complétion"]],
    body: (digest.personnes ?? []).map((p) => [
      txt(p.nom),
      txt((p.roles ?? []).join(", "), "Non défini"),
      txt(p.presence?.dureeLabel, "0 min"),
      String(p.taches?.done?.length ?? 0),
      String(p.taches?.inProgress?.length ?? 0),
      String(p.taches?.overdue?.length ?? 0),
      `${p.taches?.completionRate ?? 0} %`,
    ]),
    columnStyles: {
      0: { cellWidth: 38 },
      1: { cellWidth: 32 },
      2: { cellWidth: 22, halign: "center" },
      3: { cellWidth: 18, halign: "center" },
      4: { cellWidth: 17, halign: "center" },
      5: { cellWidth: 17, halign: "center" },
      6: { halign: "center" },
    },
  });

  const globalAttention = (digest.personnes ?? []).flatMap((p) =>
    (p.attention ?? []).map((a) => `${p.nom} — ${a}`),
  );
  sectionTitle("Points d'attention");
  if (globalAttention.length === 0) {
    doc.setTextColor(...GREY);
    body("Aucun point d'attention signalé sur la période.");
    doc.setTextColor(40, 46, 56);
  } else {
    const { rows, extra } = cap(globalAttention, 12);
    for (const a of rows) body(`• ${a}`, 2);
    if (extra > 0) body(`... et ${extra} autres`, 2);
  }

  // ---------- Détail par personne, en flux continu ----------
  const actives = (digest.personnes ?? []).filter((p) => p.hasActivity);
  const inactives = (digest.personnes ?? []).filter((p) => !p.hasActivity);

  if (actives.length > 0) {
    ensure(16);
    y += 3;
    sectionTitle("Détail par personne");
  }

  for (const p of actives) {
    // Bandeau de nom compact — saut de page seulement si le bloc ne tient pas.
    ensure(34);
    doc.setFillColor(...NAVY);
    doc.rect(M, y - 3.4, contentW, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(255, 255, 255);
    doc.text(doc.splitTextToSize(txt(p.nom), contentW * 0.6)[0], M + 2, y + 1.4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(214, 199, 160);
    const roleLine =
      `${(p.roles ?? []).join(" · ") || "Rôle non défini"}` +
      ((p.poles ?? []).length ? ` — Pôle ${(p.poles ?? []).join(", ")}` : "") +
      ` — Complétion ${p.taches?.completionRate ?? 0} %`;
    doc.text(doc.splitTextToSize(roleLine, contentW * 0.98)[0], W - M - 2, y + 1.4, { align: "right" });
    doc.setTextColor(40, 46, 56);
    y += 8;

    // Présence : une seule ligne compacte
    const pr = p.presence ?? ({} as any);
    const presenceParts = [`Connexion ${txt(pr.dureeLabel, "0 min")}`];
    if (pr.premiere || pr.derniere) presenceParts.push(`${txt(pr.premiere, "—")} - ${txt(pr.derniere, "—")}`);
    presenceParts.push(`${pr.sessions ?? 0} session${(pr.sessions ?? 0) > 1 ? "s" : ""}`);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    doc.setTextColor(...GREY);
    ensure(6);
    doc.text(presenceParts.join("  ·  "), M + 1, y + 1);
    doc.setTextColor(40, 46, 56);
    y += 6;

    // Tâches : un seul tableau, trié par état
    const ORDER: Record<string, number> = { "Terminée": 0, "En cours": 1, "En retard": 2, "Bloquée": 3, "À venir": 4 };
    const all = [...(p.taches?.all ?? [])].sort(
      (a, b) => (ORDER[a.etat] ?? 9) - (ORDER[b.etat] ?? 9),
    );
    if (all.length > 0) {
      const { rows, extra } = cap(all);
      table({
        head: [["État", "Tâche", "Client / Dossier", "Échéance / clôture", "Commentaires"]],
        body: [
          ...rows.map((t) => [
            txt(t.etat),
            txt(t.titre),
            txt(t.contexte, "—"),
            txt(t.quand, "—"),
            txt(t.commentaires, "—"),
          ]),
          ...(extra > 0 ? [[`... et ${extra} autres`, "", "", "", ""]] : []),
        ],
        columnStyles: {
          0: { cellWidth: 18 },
          1: { cellWidth: 44 },
          2: { cellWidth: 34 },
          3: { cellWidth: 24 },
          4: { cellWidth: "auto" },
        },
        didParseCell: (data: any) => {
          if (data.section !== "body") return;
          const etat = String(data.row.raw?.[0] ?? "");
          if (etat === "En retard") {
            data.cell.styles.fillColor = WARN_BG;
            if (data.column.index === 0) data.cell.styles.fontStyle = "bold";
          } else if (etat === "Bloquée") {
            data.cell.styles.fillColor = DANGER_BG;
            if (data.column.index === 0) data.cell.styles.fontStyle = "bold";
          }
        },
      });
    } else {
      body("Aucune tâche assignée sur la période.", 1, 7.8);
      y += 1;
    }

    // Actions réalisées : une ligne par type, 5 éléments max
    if ((p.actions ?? []).length > 0) {
      const rows: string[][] = (p.actions ?? []).map((a) => {
        const { rows: items, extra } = cap(a.items ?? [], 5);
        return [
          txt(a.label),
          String(a.count),
          items.join("\n") + (extra > 0 ? `\n... et ${extra} autres` : ""),
        ];
      });
      table({
        head: [["Actions réalisées", "Nb", "Détail"]],
        body: rows,
        columnStyles: {
          0: { cellWidth: 52, fontStyle: "bold" },
          1: { cellWidth: 10, halign: "center" },
          2: { cellWidth: "auto" },
        },
      });
    }

    y += 2;
  }

  // ---------- Personnes sans activité ----------
  if (inactives.length > 0) {
    ensure(12);
    y += 2;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.8);
    doc.setTextColor(...GREY);
    const line = `Sans activité sur la période : ${inactives.map((p) => p.nom).join(", ")}`;
    for (const l of doc.splitTextToSize(line, contentW) as string[]) {
      ensure(5);
      doc.text(l, M, y);
      y += 4;
    }
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 46, 56);
  }

  // ---------- En-têtes / pieds de page ----------
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    if (i > 1) {
      doc.text("Compte rendu quotidien — IZISuivis", M, 9);
      doc.setDrawColor(224, 228, 234);
      doc.setLineWidth(0.3);
      doc.line(M, 11, W - M, 11);
    }
    doc.setDrawColor(224, 228, 234);
    doc.line(M, H - 13, W - M, H - 13);
    doc.text(`IZISuivis — Compte rendu du ${txt(digest.dateFr, "")}`, M, H - 8.5);
    doc.text(`Page ${i} / ${total}`, W - M, H - 8.5, { align: "right" });
  }

  const out = new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
  console.log(`[pdf] genere en ${Date.now() - t0}ms (${total} pages, ${Math.round(out.byteLength / 1024)} Ko)`);
  return out;
}

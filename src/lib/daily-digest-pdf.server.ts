import type { DailyDigest } from "@/lib/daily-activity-report.server";

/**
 * Génération du PDF du compte rendu quotidien.
 * Aucune requête base : tout provient de l'objet DailyDigest déjà en mémoire.
 */

const NAVY: [number, number, number] = [18, 39, 71];
const NAVY_SOFT: [number, number, number] = [42, 68, 106];
const GOLD: [number, number, number] = [176, 141, 62];
const GREY: [number, number, number] = [110, 118, 130];
const LIGHT: [number, number, number] = [244, 246, 249];

const M = 15; // marge mm
const MAX_ROWS = 30;

function cap<T>(rows: T[]): { rows: T[]; extra: number } {
  if (rows.length <= MAX_ROWS) return { rows, extra: 0 };
  return { rows: rows.slice(0, MAX_ROWS), extra: rows.length - MAX_ROWS };
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
    if (y + needed > H - 20) {
      doc.addPage();
      y = M + 10;
    }
  };

  const table = (opts: Record<string, unknown>) => {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M, bottom: 20 },
      theme: "grid",
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 1.8, textColor: [40, 46, 56], overflow: "linebreak" },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
      alternateRowStyles: { fillColor: LIGHT },
      ...opts,
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 6;
  };

  const sectionTitle = (label: string) => {
    ensure(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(...NAVY);
    doc.text(label, M, y);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.6);
    doc.line(M, y + 1.6, M + 24, y + 1.6);
    y += 7;
    doc.setTextColor(40, 46, 56);
  };

  const body = (line: string, indent = 0) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(line, contentW - indent) as string[];
    for (const l of lines) {
      ensure(6);
      doc.text(l, M + indent, y);
      y += 5;
    }
  };

  // ---------- Page 1 : garde + résumé général ----------
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 42, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("Compte rendu quotidien", M, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(txt(digest.dateFr, ""), M, 29);
  doc.setFontSize(9);
  doc.setTextColor(214, 199, 160);
  doc.text(`Période couverte : ${txt(digest.periode, "journée")}`, M, 36);
  doc.setTextColor(40, 46, 56);
  y = 52;

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
      2: { cellWidth: 24 },
      3: { cellWidth: 20, halign: "center" },
      4: { cellWidth: 18, halign: "center" },
      5: { cellWidth: 20, halign: "center" },
      6: { halign: "center" },
    },
  });

  if ((digest.classement ?? []).length > 0) {
    sectionTitle("Classement — tâches terminées");
    table({
      head: [["#", "Personne", "Tâches terminées"]],
      body: digest.classement.map((c, i) => [String(i + 1), txt(c.nom), String(c.done)]),
      columnStyles: { 0: { cellWidth: 12, halign: "center" }, 2: { cellWidth: 40, halign: "center" } },
    });
  }

  const globalAttention = (digest.personnes ?? []).flatMap((p) =>
    (p.attention ?? []).map((a) => `${p.nom} — ${a}`),
  );
  sectionTitle("Points d'attention");
  if (globalAttention.length === 0) {
    doc.setTextColor(...GREY);
    body("Aucun point d'attention signalé sur la période.");
    doc.setTextColor(40, 46, 56);
  } else {
    for (const a of cap(globalAttention).rows) body(`• ${a}`, 2);
    const extra = cap(globalAttention).extra;
    if (extra > 0) body(`... et ${extra} autres`, 2);
  }

  // ---------- Une page par personne ----------
  for (const p of digest.personnes ?? []) {
    doc.addPage();
    y = M + 8;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.setTextColor(...NAVY);
    doc.text(doc.splitTextToSize(txt(p.nom), contentW)[0], M, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...GREY);
    const roleLine =
      `${(p.roles ?? []).join(" · ") || "Rôle non défini"}` +
      ((p.poles ?? []).length ? ` — Pôle ${(p.poles ?? []).join(", ")}` : "");
    doc.text(doc.splitTextToSize(roleLine, contentW), M, y);
    y += 8;
    doc.setTextColor(40, 46, 56);

    const pr = p.presence ?? ({} as any);
    sectionTitle("Présence");
    table({
      head: [["Durée de connexion", "Première connexion", "Dernière activité", "Sessions", "Ville", "Appareil"]],
      body: [[
        txt(pr.dureeLabel, "0 min"),
        txt(pr.premiere),
        txt(pr.derniere),
        String(pr.sessions ?? 0),
        txt((pr.lieux ?? []).join(", ")),
        txt((pr.appareils ?? []).join(", ")),
      ]],
    });

    if (!p.hasActivity) {
      ensure(12);
      doc.setFillColor(...LIGHT);
      doc.rect(M, y - 4, contentW, 10, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...NAVY_SOFT);
      doc.text("Aucune activité enregistrée sur la période", M + 3, y + 2.5);
      y += 12;
      doc.setTextColor(40, 46, 56);
    }

    const t = p.taches ?? ({} as any);

    const taskTable = (
      title: string,
      head: string[],
      rows: any[],
      map: (x: any) => string[],
      colStyles?: Record<number, any>,
    ) => {
      if (!rows || rows.length === 0) return;
      const { rows: shown, extra } = cap(rows);
      sectionTitle(`${title} (${rows.length})`);
      table({
        head: [head],
        body: [
          ...shown.map(map),
          ...(extra > 0 ? [[`... et ${extra} autres`, ...head.slice(1).map(() => "")]] : []),
        ],
        columnStyles: colStyles,
      });
    };

    taskTable(
      "Tâches terminées",
      ["Tâche", "Client / Dossier", "Priorité", "Heure", "Note"],
      t.done ?? [],
      (x) => [txt(x.titre), txt(x.contexte), txt(x.priorite), txt(x.heure), txt(x.note, "")],
      { 0: { cellWidth: 48 }, 1: { cellWidth: 40 }, 2: { cellWidth: 20 }, 3: { cellWidth: 16 } },
    );

    taskTable(
      "Tâches en cours",
      ["Tâche", "Client / Dossier", "Échéance", "Depuis (jours)"],
      t.inProgress ?? [],
      (x) => [txt(x.titre), txt(x.contexte), txt(x.echeance), String(x.depuis ?? 0)],
      { 0: { cellWidth: 60 }, 1: { cellWidth: 50 }, 2: { cellWidth: 28 }, 3: { halign: "center" } },
    );

    taskTable(
      "Tâches à venir",
      ["Tâche", "Client / Dossier", "Échéance"],
      t.upcoming ?? [],
      (x) => [txt(x.titre), txt(x.contexte), txt(x.echeance)],
      { 2: { cellWidth: 30 } },
    );

    taskTable(
      "Tâches en retard",
      ["Tâche", "Échéance dépassée le"],
      t.overdue ?? [],
      (x) => [txt(x.titre), txt(x.echeance)],
      { 1: { cellWidth: 45 } },
    );

    taskTable(
      "Tâches bloquées",
      ["Tâche", "Client / Dossier"],
      t.blocked ?? [],
      (x) => [txt(x.titre), txt(x.contexte)],
      { 1: { cellWidth: 60 } },
    );

    ensure(10);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...NAVY_SOFT);
    doc.text(`Taux de complétion : ${t.completionRate ?? 0} %`, M, y);
    y += 8;
    doc.setTextColor(40, 46, 56);

    if ((p.actions ?? []).length > 0) {
      sectionTitle("Actions réalisées");
      const rows: string[][] = [];
      for (const a of p.actions) {
        const { rows: items, extra } = cap(a.items ?? []);
        rows.push([`${a.label}`, String(a.count), items.join("\n") + (extra > 0 ? `\n... et ${extra} autres` : "")]);
      }
      table({
        head: [["Type d'action", "Nb", "Détail (heure — objet concerné)"]],
        body: rows,
        columnStyles: {
          0: { cellWidth: 52, fontStyle: "bold" },
          1: { cellWidth: 12, halign: "center" },
        },
      });
    }

    if ((p.contexts ?? []).length > 0) {
      sectionTitle("Clients et dossiers touchés");
      body(p.contexts.join(" · '"). replace(/ · '/g, " · "), 2);
    }

    if ((p.attention ?? []).length > 0) {
      sectionTitle("Points d'attention");
      for (const a of cap(p.attention).rows) body(`• ${a}`, 2);
      const extra = cap(p.attention).extra;
      if (extra > 0) body(`... et ${extra} autres`, 2);
    }
  }

  // ---------- En-têtes / pieds de page ----------
  const total = doc.getNumberOfPages();
  const names = ["", ...(digest.personnes ?? []).map((p) => p.nom)];
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    if (i > 1) {
      const label = names[i - 1] ?? "";
      if (label) doc.text(doc.splitTextToSize(label, contentW - 40)[0], M, 10);
      doc.setDrawColor(224, 228, 234);
      doc.setLineWidth(0.3);
      doc.line(M, 12, W - M, 12);
    }
    doc.setDrawColor(224, 228, 234);
    doc.line(M, H - 14, W - M, H - 14);
    doc.text(`IZISuivis — Compte rendu du ${txt(digest.dateFr, "")}`, M, H - 9);
    doc.text(`Page ${i} / ${total}`, W - M, H - 9, { align: "right" });
  }

  const out = new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
  console.log(`[pdf] genere en ${Date.now() - t0}ms (${total} pages, ${Math.round(out.byteLength / 1024)} Ko)`);
  return out;
}

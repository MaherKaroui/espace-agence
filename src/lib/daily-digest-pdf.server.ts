import type { DailyDigest } from "@/lib/daily-activity-report.server";

/**
 * PDF du compte rendu quotidien — organisé PAR PÔLE, 3 à 5 pages.
 * Pensé pour être compris par un lecteur qui ne connaît pas l'agence.
 * Aucune requête base : tout provient de l'objet DailyDigest déjà en mémoire.
 */

const NAVY: [number, number, number] = [18, 39, 71];
const NAVY_SOFT: [number, number, number] = [42, 68, 106];
const GOLD: [number, number, number] = [176, 141, 62];
const GREY: [number, number, number] = [110, 118, 130];
const LIGHT: [number, number, number] = [244, 246, 249];
const WARN_BG: [number, number, number] = [253, 240, 224];
const DANGER_BG: [number, number, number] = [253, 232, 232];
const OK_BG: [number, number, number] = [232, 246, 238];

const M = 15; // marge mm

function cap<T>(rows: T[], max: number): { rows: T[]; extra: number } {
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
      styles: {
        font: "helvetica",
        fontSize: 7.6,
        cellPadding: 1.3,
        textColor: [40, 46, 56],
        overflow: "linebreak",
        lineColor: [222, 227, 234],
      },
      headStyles: {
        fillColor: NAVY,
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 7.6,
        cellPadding: 1.4,
      },
      alternateRowStyles: { fillColor: LIGHT },
      ...opts,
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 4.5;
  };

  const sectionTitle = (label: string, subtitle?: string) => {
    ensure(subtitle ? 15 : 11);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...NAVY_SOFT);
    doc.text(label.toUpperCase(), M, y);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.6);
    doc.line(M, y + 2.4, M + 18, y + 2.4);
    y += 6.5;
    if (subtitle) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.6);
      doc.setTextColor(...GREY);
      for (const l of doc.splitTextToSize(subtitle, contentW) as string[]) {
        doc.text(l, M, y);
        y += 3.8;
      }
      y += 1.5;
    }
    doc.setFont("helvetica", "normal");
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

  // ---------- En-tête ----------
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

  // ---------- Comment lire ce document ----------
  const guideLines = [
    "Ce document résume l'activité de l'agence sur la journée, pôle par pôle. Un pôle est une équipe interne (ex. Qualiopi, Juridique).",
    "Un dossier est un accompagnement suivi pour un client. Une tâche est une action à réaliser dans ce cadre.",
    "États des tâches : Terminée (faite aujourd'hui) · En cours (démarrée) · En retard (échéance dépassée) · Bloquée (attente d'un tiers) · À venir (pas encore commencée).",
  ];
  doc.setFillColor(...LIGHT);
  const guideWrapped = guideLines.flatMap(
    (l) => doc.splitTextToSize(l, contentW - 6) as string[],
  );
  const guideH = 7 + guideWrapped.length * 3.7;
  doc.roundedRect(M, y, contentW, guideH, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.8);
  doc.setTextColor(...NAVY_SOFT);
  doc.text("COMMENT LIRE CE DOCUMENT", M + 3, y + 4.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(70, 78, 90);
  let gy = y + 8.5;
  for (const l of guideWrapped) {
    doc.text(l, M + 3, gy);
    gy += 3.7;
  }
  doc.setTextColor(40, 46, 56);
  y += guideH + 6;

  // ---------- Chiffres clés ----------
  const s = digest.synthese;
  sectionTitle("Chiffres clés de la journée");
  table({
    head: [["Indicateur", "Valeur", "Indicateur", "Valeur"]],
    body: [
      ["Personnes connectées", `${s.connectes} / ${s.equipe}`, "Temps de connexion cumulé", txt(s.tempsCumule, "0 min")],
      ["Tâches terminées aujourd'hui", String(s.tachesTerminees), "Tâches en cours", String(s.tachesEnCours)],
      ["Tâches en retard", String(s.tachesEnRetard), "Dossiers créés", String(s.dossiersCrees)],
      ["Changements de statut de dossier", String(s.changementsStatut), "Documents déposés", String(s.documentsDeposes)],
      ["Messages échangés", String(s.messages), "Nouveaux clients", String(s.nouveauxClients)],
    ],
    columnStyles: {
      0: { cellWidth: contentW * 0.3, fontStyle: "bold" },
      1: { cellWidth: contentW * 0.2 },
      2: { cellWidth: contentW * 0.3, fontStyle: "bold" },
      3: { cellWidth: contentW * 0.2 },
    },
  });

  // ---------- À traiter en priorité ----------
  const prios = digest.priorites ?? [];
  sectionTitle(
    "À traiter en priorité",
    "Tâches dont l'échéance est dépassée ou qui sont bloquées, du plus ancien retard au plus récent.",
  );
  if (prios.length === 0) {
    doc.setTextColor(...GREY);
    body("Aucune tâche en retard ni bloquée. Rien ne requiert d'arbitrage immédiat.");
    doc.setTextColor(40, 46, 56);
    y += 2;
  } else {
    const { rows, extra } = cap(prios, 14);
    table({
      head: [["État", "Tâche", "Pôle", "Responsable", "Client / Dossier", "Retard"]],
      body: [
        ...rows.map((p) => [
          p.etat,
          txt(p.titre),
          txt(p.pole),
          txt(p.responsable, "Non assignée"),
          txt(p.contexte),
          p.joursRetard === null ? "—" : `${p.joursRetard} j`,
        ]),
        ...(extra > 0 ? [[`... et ${extra} autres`, "", "", "", "", ""]] : []),
      ],
      columnStyles: {
        0: { cellWidth: 17, fontStyle: "bold" },
        1: { cellWidth: 45 },
        2: { cellWidth: 26 },
        3: { cellWidth: 28 },
        4: { cellWidth: "auto" },
        5: { cellWidth: 14, halign: "center" },
      },
      didParseCell: (data: any) => {
        if (data.section !== "body") return;
        const etat = String(data.row.raw?.[0] ?? "");
        if (etat === "En retard") data.cell.styles.fillColor = WARN_BG;
        else if (etat === "Bloquée") data.cell.styles.fillColor = DANGER_BG;
      },
    });
  }

  // ---------- Activité par pôle ----------
  const sections = digest.poleSections ?? [];
  if (sections.length > 0) {
    sectionTitle(
      "Activité par pôle",
      "Pour chaque équipe : le volume traité, puis le détail des tâches avec leur responsable et les échanges internes datés.",
    );

    // Vue d'ensemble des pôles
    table({
      head: [["Pôle", "Personnes", "Terminées", "Ouvertes", "En retard"]],
      body: sections.map((sec) => [
        txt(sec.pole),
        String(sec.collaborateurs),
        String(sec.termineesJour),
        String(sec.ouvertes),
        String(sec.enRetard),
      ]),
      columnStyles: {
        0: { cellWidth: "auto", fontStyle: "bold" },
        1: { cellWidth: 22, halign: "center" },
        2: { cellWidth: 24, halign: "center" },
        3: { cellWidth: 22, halign: "center" },
        4: { cellWidth: 22, halign: "center" },
      },
    });

    for (const sec of sections) {
      ensure(30);
      y += 1.5;
      // Bandeau de pôle
      doc.setFillColor(...NAVY);
      doc.rect(M, y - 3.6, contentW, 7.4, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(255, 255, 255);
      doc.text(doc.splitTextToSize(txt(sec.pole), contentW * 0.55)[0], M + 2.5, y + 1.4);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(214, 199, 160);
      doc.text(
        `${sec.collaborateurs} personne${sec.collaborateurs > 1 ? "s" : ""}  ·  ${sec.termineesJour} terminée${sec.termineesJour > 1 ? "s" : ""}  ·  ${sec.ouvertes} ouverte${sec.ouvertes > 1 ? "s" : ""}  ·  ${sec.enRetard} en retard`,
        W - M - 2.5,
        y + 1.4,
        { align: "right" },
      );
      doc.setTextColor(40, 46, 56);
      y += 8.5;

      const { rows, extra } = cap(sec.taches, 22);
      table({
        head: [["État", "Tâche", "Responsable", "Client / Dossier", "Échéance / clôture", "Échanges internes"]],
        body: [
          ...rows.map((t) => [
            t.etat,
            txt(t.titre),
            txt(t.responsable, "Non assignée"),
            txt(t.contexte),
            txt(t.quand),
            txt(t.commentaires, "Aucun échange enregistré"),
          ]),
          ...(extra > 0 ? [[`... et ${extra} autres tâches`, "", "", "", "", ""]] : []),
        ],
        columnStyles: {
          0: { cellWidth: 16 },
          1: { cellWidth: 38 },
          2: { cellWidth: 24 },
          3: { cellWidth: 28 },
          4: { cellWidth: 20 },
          5: { cellWidth: "auto" },
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
          } else if (etat === "Terminée") {
            data.cell.styles.fillColor = OK_BG;
          }
          if (data.column.index === 5) {
            data.cell.styles.fontSize = 6.9;
            data.cell.styles.textColor = [78, 86, 98];
          }
        },
      });
    }
  }

  // ---------- Présence de l'équipe ----------
  const personnes = digest.personnes ?? [];
  if (personnes.length > 0) {
    ensure(24);
    sectionTitle(
      "Présence de l'équipe",
      "Temps de connexion à la plateforme sur la période. Une absence de connexion ne signifie pas une absence de travail.",
    );
    const presents = personnes.filter((p) => (p.presence?.seconds ?? 0) > 0);
    const absents = personnes.filter((p) => (p.presence?.seconds ?? 0) === 0);
    if (presents.length > 0) {
      const { rows, extra } = cap(presents, 20);
      table({
        head: [["Nom", "Rôle", "Pôle", "Connexion", "Plage", "Terminées"]],
        body: [
          ...rows.map((p) => [
            txt(p.nom),
            txt((p.roles ?? []).join(", "), "Non défini"),
            txt((p.poles ?? []).join(", "), "—"),
            txt(p.presence?.dureeLabel, "0 min"),
            `${txt(p.presence?.premiere)} - ${txt(p.presence?.derniere)}`,
            String(p.taches?.done?.length ?? 0),
          ]),
          ...(extra > 0 ? [[`... et ${extra} autres`, "", "", "", "", ""]] : []),
        ],
        columnStyles: {
          0: { cellWidth: 36 },
          1: { cellWidth: 30 },
          2: { cellWidth: 28 },
          3: { cellWidth: 20, halign: "center" },
          4: { cellWidth: "auto", halign: "center" },
          5: { cellWidth: 20, halign: "center" },
        },
      });
    } else {
      body("Aucune connexion enregistrée sur la période.", 0, 7.8);
    }
    if (absents.length > 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.6);
      doc.setTextColor(...GREY);
      const line = `Sans connexion sur la période : ${absents.map((p) => p.nom).join(", ")}`;
      for (const l of doc.splitTextToSize(line, contentW) as string[]) {
        ensure(5);
        doc.text(l, M, y);
        y += 3.9;
      }
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 46, 56);
    }
  }

  // ---------- Points d'attention ----------
  const globalAttention = personnes.flatMap((p) => (p.attention ?? []).map((a) => `${p.nom} — ${a}`));
  if (globalAttention.length > 0) {
    ensure(16);
    y += 2;
    sectionTitle("Points d'attention", "Signaux relevés automatiquement, à vérifier par la direction.");
    const { rows, extra } = cap(globalAttention, 10);
    for (const a of rows) body(`• ${a}`, 2, 7.8);
    if (extra > 0) body(`... et ${extra} autres`, 2, 7.8);
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

import type { DailyDigest, DigestTaskRow } from "@/lib/daily-activity-report.server";

/**
 * PDF du compte rendu quotidien — 2 PAGES MAXIMUM (plafond dur).
 * Page 1 : vue d'ensemble (chiffres clés, synthèse par pôle, priorités).
 * Page 2 : ce qui s'est passé (activité de la période, échanges internes, présence).
 * Le backlog qui n'a pas bougé n'apparaît que sous forme de compteurs.
 */

const NAVY: [number, number, number] = [18, 39, 71];
const NAVY_SOFT: [number, number, number] = [42, 68, 106];
const GOLD: [number, number, number] = [176, 141, 62];
const GREY: [number, number, number] = [110, 118, 130];
const LIGHT: [number, number, number] = [244, 246, 249];
const WARN_BG: [number, number, number] = [253, 240, 224];
const DANGER_BG: [number, number, number] = [253, 232, 232];

const M = 14; // marge mm

function txt(v: unknown, fallback = "—"): string {
  const s = v === null || v === undefined ? "" : String(v);
  return s.trim() === "" ? fallback : s;
}

const norm = (v: string) =>
  v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Titre de la tâche + client, sans recopier le client déjà présent dans le titre. */
function libelleTache(titre: string, contexte: string | null): string {
  const t = txt(titre);
  const c = contexte ? String(contexte).trim() : "";
  if (!c) return t;
  return norm(t).includes(norm(c)) ? t : `${t} — ${c}`;
}

/** Jours (JJ/MM) couverts par la période, extraits du libellé « du 22/08/2026 au 24/08/2026 ». */
function joursDeLaPeriode(periode: string): Set<string> {
  const dates = [...String(periode ?? "").matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)];
  const out = new Set<string>();
  if (dates.length === 0) return out;
  const toDate = (m: RegExpMatchArray) => new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const start = toDate(dates[0]);
  const end = toDate(dates[dates.length - 1]);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.add(`${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Un échange est daté « JJ/MM HH:MM  … » : on regarde s'il tombe dans la période. */
function echangeDansPeriode(ligne: string, jours: Set<string>): boolean {
  const m = /^(\d{2}\/\d{2})\s/.exec(ligne.trim());
  return m ? jours.has(m[1]) : false;
}

interface TacheAvecEchanges {
  titre: string;
  pole: string;
  echanges: string[];
  recent: boolean;
}

export async function buildDailyDigestPdf(digest: DailyDigest): Promise<Uint8Array> {
  const t0 = Date.now();
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable: any = (autoTableMod as any).default ?? autoTableMod;

  // ---------- Préparation des données (indépendante du rendu) ----------
  const s = digest.synthese;
  const sections = digest.poleSections ?? [];
  const personnes = digest.personnes ?? [];
  const prios = [...(digest.priorites ?? [])].sort(
    (a, b) => (b.joursRetard ?? -1) - (a.joursRetard ?? -1),
  );
  const jours = joursDeLaPeriode(digest.periode ?? "");

  const enRetardOuBloquee = (t: DigestTaskRow) => t.etat === "En retard" || t.etat === "Bloquée";

  const tachesCommentees: TacheAvecEchanges[] = [];
  const terminees: { titre: string; pole: string; quand: string | null }[] = [];
  for (const sec of sections) {
    for (const t of sec.taches ?? []) {
      const ech = t.echanges ?? [];
      if (t.etat === "Terminée") {
        terminees.push({ titre: libelleTache(t.titre, t.contexte), pole: sec.pole, quand: t.quand });
      }
      const recent = ech.some((e) => echangeDansPeriode(e, jours));
      if (ech.length > 0 && (recent || enRetardOuBloquee(t))) {
        tachesCommentees.push({
          titre: libelleTache(t.titre, t.contexte),
          pole: sec.pole,
          echanges: ech,
          recent,
        });
      }
    }
  }
  // Les échanges de la période d'abord, puis les tâches bloquantes.
  tachesCommentees.sort((a, b) => Number(b.recent) - Number(a.recent));

  const presents = personnes.filter((p) => (p.presence?.seconds ?? 0) > 0);
  const absents = personnes.filter((p) => (p.presence?.seconds ?? 0) === 0);
  const attentions = personnes.flatMap((p) => (p.attention ?? []).map((a) => `${p.nom} — ${a}`));

  /**
   * Rendu complet du document pour un niveau de réduction donné.
   * niveau 0 : tout · 1 : présence résumée · 2 : priorités limitées à 10
   * maxEchanges : nombre de tâches conservées dans le bloc « Échanges internes ».
   */
  const render = (niveau: number, maxEchanges: number) => {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const contentW = W - M * 2;
    doc.setFont("helvetica", "normal");
    let y = M;

    const ensure = (needed: number) => {
      if (y + needed > H - 14) {
        doc.addPage();
        y = M;
      }
    };

    const table = (opts: Record<string, unknown>) => {
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M, top: M, bottom: 14 },
        theme: "grid",
        rowPageBreak: "avoid",
        styles: {
          font: "helvetica",
          fontSize: 7,
          cellPadding: 0.9,
          textColor: [40, 46, 56],
          overflow: "hidden",
          lineColor: [224, 229, 236],
        },
        headStyles: {
          fillColor: NAVY,
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 7,
          cellPadding: 1.1,
        },
        alternateRowStyles: { fillColor: LIGHT },
        ...opts,
      });
      y = ((doc as any).lastAutoTable?.finalY ?? y) + 3.6;
    };

    const sectionTitle = (label: string) => {
      ensure(14);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...NAVY_SOFT);
      doc.text(label.toUpperCase(), M, y);
      doc.setDrawColor(...GOLD);
      doc.setLineWidth(0.6);
      doc.line(M, y + 1.9, M + 16, y + 1.9);
      y += 5.6;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 46, 56);
    };

    const line = (text: string, size = 7, indent = 0, color: [number, number, number] = [60, 68, 80]) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      doc.setTextColor(...color);
      for (const l of doc.splitTextToSize(text, contentW - indent) as string[]) {
        ensure(4);
        doc.text(l, M + indent, y);
        y += size * 0.42 + 0.7;
      }
      doc.setTextColor(40, 46, 56);
    };

    // ---------- 1. Bandeau ----------
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 24, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Compte rendu quotidien", M, 11);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(txt(digest.dateFr, ""), M, 17.5);
    doc.setFontSize(7);
    doc.setTextColor(214, 199, 160);
    doc.text(`Période : ${txt(digest.periode, "journée")}`, W - M, 17.5, { align: "right" });
    doc.setTextColor(40, 46, 56);
    y = 28.5;

    // ---------- 2. Comment lire (2 lignes) ----------
    const guide = [
      "Ce document ne retrace que l'activité de la période et ce qui bloque actuellement ; le backlog stable n'apparaît qu'en compteurs.",
      "Un pôle est une équipe interne, un dossier un accompagnement client, une tâche une action à réaliser dans ce cadre.",
    ];
    doc.setFillColor(...LIGHT);
    doc.roundedRect(M, y, contentW, 10.5, 1.2, 1.2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.6);
    doc.setTextColor(70, 78, 90);
    doc.text(guide[0], M + 2.5, y + 4.2);
    doc.text(guide[1], M + 2.5, y + 7.8);
    doc.setTextColor(40, 46, 56);
    y += 14;

    // ---------- 3. Chiffres clés (bande d'indicateurs) ----------
    const kpis: [string, string][] = [
      [`${s.connectes}/${s.equipe}`, "Connectés"],
      [txt(s.tempsCumule, "0 min"), "Temps cumulé"],
      [String(s.tachesTerminees), "Terminées"],
      [String(s.tachesEnCours), "En cours"],
      [String(s.tachesEnRetard), "En retard"],
      [String(s.dossiersCrees), "Dossiers créés"],
      [String(s.changementsStatut), "Chgts statut"],
      [String(s.documentsDeposes), "Documents"],
      [String(s.messages), "Messages"],
      [String(s.nouveauxClients), "Nx clients"],
    ];
    const perRow = 5;
    const cellW = contentW / perRow;
    const cellH = 11;
    kpis.forEach((kpi, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const x = M + col * cellW;
      const yy = y + row * cellH;
      doc.setFillColor(...LIGHT);
      doc.roundedRect(x + 0.6, yy, cellW - 1.2, cellH - 1.4, 1, 1, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...NAVY);
      doc.text(kpi[0], x + cellW / 2, yy + 5, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.2);
      doc.setTextColor(...GREY);
      doc.text(kpi[1], x + cellW / 2, yy + 8.4, { align: "center" });
    });
    doc.setTextColor(40, 46, 56);
    y += Math.ceil(kpis.length / perRow) * cellH + 3;

    // ---------- 4. Synthèse par pôle ----------
    if (sections.length > 0) {
      sectionTitle("Synthèse par pôle");
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
          2: { cellWidth: 22, halign: "center" },
          3: { cellWidth: 22, halign: "center" },
          4: { cellWidth: 22, halign: "center" },
        },
      });
    }

    // ---------- 5. À traiter en priorité ----------
    sectionTitle("À traiter en priorité");
    if (prios.length === 0) {
      line("Aucune tâche en retard ni bloquée.", 7, 0, GREY);
      y += 2;
    } else {
      const maxPrio = niveau >= 2 ? 10 : prios.length;
      const rows = prios.slice(0, maxPrio);
      const extra = prios.length - rows.length;
      table({
        head: [["Tâche", "Pôle", "Responsable", "Retard"]],
        body: [
          ...rows.map((p) => [
            libelleTache(p.titre, p.contexte),
            txt(p.pole),
            txt(p.responsable, "Non assignée"),
            p.joursRetard === null ? p.etat : `${p.joursRetard} j`,
          ]),
          ...(extra > 0 ? [[`... et ${extra} autres tâches en retard ou bloquées`, "", "", ""]] : []),
        ],
        columnStyles: {
          0: { cellWidth: "auto" },
          1: { cellWidth: 26 },
          2: { cellWidth: 30 },
          3: { cellWidth: 14, halign: "center" },
        },
        didParseCell: (data: any) => {
          if (data.section !== "body") return;
          const raw = String(data.row.raw?.[3] ?? "");
          data.cell.styles.fillColor = raw === "Bloquée" ? DANGER_BG : raw ? WARN_BG : [255, 255, 255];
        },
      });
    }

    // ---------- 6. Activité de la période ----------
    sectionTitle("Activité de la période");
    if (terminees.length === 0) {
      line("Aucune tâche terminée sur la période.", 7, 0, GREY);
    } else {
      table({
        head: [["Tâche terminée", "Pôle", "Clôture"]],
        body: terminees.slice(0, 12).map((t) => [t.titre, t.pole, txt(t.quand)]),
        columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 30 }, 2: { cellWidth: 24 } },
      });
    }
    const faits: string[] = [];
    faits.push(
      s.dossiersCrees > 0 ? `${s.dossiersCrees} nouveau(x) dossier(s) créé(s)` : "Aucun nouveau dossier",
    );
    faits.push(
      s.changementsStatut > 0
        ? `${s.changementsStatut} changement(s) de statut de dossier`
        : "Aucun changement de statut",
    );
    faits.push(
      s.documentsDeposes > 0 ? `${s.documentsDeposes} document(s) déposé(s)` : "Aucun document déposé",
    );
    faits.push(s.messages > 0 ? `${s.messages} message(s) échangé(s)` : "Aucun message échangé");
    line(faits.join("  ·  "), 7, 0, [60, 68, 80]);
    y += 2;

    // ---------- 7. Échanges internes ----------
    const affichees = tachesCommentees.slice(0, maxEchanges);
    const masquees = tachesCommentees.length - affichees.length;
    if (tachesCommentees.length > 0) {
      sectionTitle("Échanges internes");
      line(
        "Tâches commentées sur la période et tâches en retard ou bloquées (historique complet).",
        6.4,
        0,
        GREY,
      );
      y += 0.8;
      for (const t of affichees) {
        const titreLignes = doc.splitTextToSize(`${t.titre}  (${t.pole})`, contentW) as string[];
        ensure(titreLignes.length * 3 + 4);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.8);
        doc.setTextColor(...NAVY_SOFT);
        for (const l of titreLignes) {
          doc.text(l, M, y);
          y += 2.9;
        }
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.4);
        doc.setTextColor(72, 80, 92);
        for (const c of t.echanges) {
          // Un commentaire est affiché en entier ou pas du tout : on réserve sa hauteur.
          const lignes = doc.splitTextToSize(c, contentW - 4) as string[];
          ensure(lignes.length * 2.8);
          for (const l of lignes) {
            doc.text(l, M + 4, y);
            y += 2.8;
          }
        }
        doc.setTextColor(40, 46, 56);
        y += 1.2;
      }
      if (masquees > 0) {
        line(`${masquees} autre(s) tâche(s) commentée(s) non affichée(s), faute de place.`, 6.4, 0, GREY);
      }
      y += 1.5;
    }

    // ---------- 8. Présence ----------
    sectionTitle("Présence");
    if (niveau >= 1) {
      const resume = `${presents.length} personne(s) connectée(s) sur ${personnes.length} · temps cumulé ${txt(s.tempsCumule, "0 min")}`;
      line(resume, 6.8, 0, [60, 68, 80]);
    } else if (presents.length === 0) {
      line("Aucune connexion enregistrée sur la période.", 6.8, 0, GREY);
    } else {
      for (const p of presents) {
        line(
          `${txt(p.nom)} — ${txt(p.presence?.dureeLabel, "0 min")} · ${txt(p.presence?.plage, "—")} · ${p.taches?.done?.length ?? 0} terminée(s)`,
          6.8,
          0,
          [60, 68, 80],
        );
      }
    }
    if (absents.length > 0) {
      line(`Sans connexion sur la période : ${absents.map((p) => p.nom).join(", ")}`, 6.4, 0, GREY);
    }
    y += 1.5;

    // ---------- 9. Points d'attention ----------
    if (attentions.length > 0) {
      sectionTitle("Points d'attention");
      for (const a of attentions.slice(0, 5)) line(`• ${a}`, 6.6, 1.5, [60, 68, 80]);
      if (attentions.length > 5) line(`• ... et ${attentions.length - 5} autres`, 6.6, 1.5, GREY);
    }

    // ---------- Pieds de page ----------
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.4);
      doc.setTextColor(...GREY);
      doc.setDrawColor(226, 230, 236);
      doc.setLineWidth(0.3);
      doc.line(M, H - 10.5, W - M, H - 10.5);
      doc.text(`IZISuivis — Compte rendu du ${txt(digest.dateFr, "")}`, M, H - 7);
      doc.text(`Page ${i} / ${total}`, W - M, H - 7, { align: "right" });
      if (i === total) {
        doc.setFont("helvetica", "italic");
        doc.text(
          "Le détail complet des tâches ouvertes est consultable dans l'application.",
          W / 2,
          H - 7,
          { align: "center" },
        );
      }
    }

    return { doc, pages: total, niveau, affichees: affichees.length, masquees };
  };

  // ---------- Garde-fou 2 pages ----------
  let result = render(0, tachesCommentees.length);
  const reductions: string[] = [];
  if (result.pages > 2) {
    result = render(1, tachesCommentees.length);
    reductions.push("présence résumée");
  }
  if (result.pages > 2) {
    result = render(2, tachesCommentees.length);
    reductions.push("priorités limitées à 10");
  }
  let maxEch = tachesCommentees.length;
  while (result.pages > 2 && maxEch > 0) {
    maxEch -= 1;
    result = render(2, maxEch);
  }
  if (maxEch < tachesCommentees.length) reductions.push(`échanges limités à ${maxEch} tâches`);

  const out = new Uint8Array(result.doc.output("arraybuffer") as ArrayBuffer);
  console.log(
    `[pdf] genere en ${Date.now() - t0}ms (${result.pages} pages, ${Math.round(out.byteLength / 1024)} Ko)` +
      (reductions.length ? ` — reductions: ${reductions.join(", ")}` : " — aucune reduction"),
  );
  return out;
}

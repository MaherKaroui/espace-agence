import type { DailyDigest } from "@/lib/daily-activity-report.server";

/**
 * PDF du compte rendu D'UNE SEULE JOURNÉE — 2 pages maximum.
 * Il ne raconte QUE ce que l'équipe a fait ce jour-là :
 * activité par pôle puis par personne, échanges du jour, présence.
 * Le backlog qui n'a pas bougé n'y figure pas (juste une ligne de vigilance).
 */

const NAVY: [number, number, number] = [18, 39, 71];
const NAVY_SOFT: [number, number, number] = [42, 68, 106];
const GOLD: [number, number, number] = [176, 141, 62];
const GREY: [number, number, number] = [110, 118, 130];
const LIGHT: [number, number, number] = [244, 246, 249];

const M = 14; // marge mm

function txt(v: unknown, fallback = "—"): string {
  const s = v === null || v === undefined ? "" : String(v);
  return s.trim() === "" ? fallback : s;
}

export async function buildDailyDigestPdf(digest: DailyDigest): Promise<Uint8Array> {
  const t0 = Date.now();
  const { jsPDF } = await import("jspdf");

  const j = digest.journee ?? {
    poles: [],
    echanges: [],
    retards: { total: 0, plusAnciennes: [] },
    presence: [],
    absents: [],
    chiffres: {
      tachesTerminees: 0,
      dossiersCrees: 0,
      documentsDeposes: 0,
      messages: 0,
      personnesActives: 0,
    },
    calme: true,
  };
  const c = j.chiffres;

  /**
   * niveau 0 : tout · 1 : présence en une ligne · 2 : événements limités par personne.
   */
  const render = (niveau: number, maxEvents: number, maxEchanges: number) => {
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

    const line = (
      text: string,
      size = 7,
      indent = 0,
      color: [number, number, number] = [60, 68, 80],
      bold = false,
    ) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.setTextColor(...color);
      const lignes = doc.splitTextToSize(text, contentW - indent) as string[];
      // Un commentaire est affiché en entier ou pas du tout.
      ensure(Math.min(lignes.length, 4) * (size * 0.42 + 0.7));
      for (const l of lignes) {
        ensure(4);
        doc.text(l, M + indent, y);
        y += size * 0.42 + 0.7;
      }
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 46, 56);
    };

    // ---------- 1. Bandeau ----------
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 22, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Compte rendu de la journée", M, 11);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
    doc.setTextColor(214, 199, 160);
    doc.text(txt(digest.periode, digest.dateFr), M, 17);
    doc.setTextColor(40, 46, 56);
    y = 26;

    // ---------- 2. Comment lire (2 lignes) ----------
    doc.setFillColor(...LIGHT);
    doc.roundedRect(M, y, contentW, 10.5, 1.2, 1.2, "F");
    doc.setFontSize(6.6);
    doc.setTextColor(70, 78, 90);
    doc.text(
      "Ce document ne retrace que l'activité de cette seule journée : ce qui a été fait, par qui et à quelle heure.",
      M + 2.5,
      y + 4.2,
    );
    doc.text(
      "Un pôle est une équipe interne, un dossier un accompagnement client, une tâche une action à réaliser.",
      M + 2.5,
      y + 7.8,
    );
    doc.setTextColor(40, 46, 56);
    y += 14;

    // ---------- 3. Chiffres du jour ----------
    const kpis: [string, string][] = [
      [String(c.tachesTerminees), "Tâches terminées"],
      [String(c.dossiersCrees), "Dossiers créés"],
      [String(c.documentsDeposes), "Documents déposés"],
      [String(c.messages), "Messages"],
      [String(c.personnesActives), "Personnes actives"],
    ];
    const cellW = contentW / kpis.length;
    const cellH = 11;
    kpis.forEach((kpi, i) => {
      const x = M + i * cellW;
      doc.setFillColor(...LIGHT);
      doc.roundedRect(x + 0.6, y, cellW - 1.2, cellH - 1.4, 1, 1, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...NAVY);
      doc.text(kpi[0], x + cellW / 2, y + 5, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.2);
      doc.setTextColor(...GREY);
      doc.text(kpi[1], x + cellW / 2, y + 8.4, { align: "center" });
    });
    doc.setTextColor(40, 46, 56);
    y += cellH + 4;

    // ---------- 4. Vigilance (une ligne) ----------
    if (j.retards.total > 0) {
      const suite = j.retards.plusAnciennes.length
        ? `, dont les plus anciennes : ${j.retards.plusAnciennes.join(" · ")}`
        : "";
      line(`Vigilance : ${j.retards.total} tâche(s) en retard${suite}.`, 6.8, 0, [150, 60, 40]);
      y += 1.5;
    }

    // ---------- 5. Ce qui a été fait, par pôle puis par personne ----------
    sectionTitle("Ce qui a été fait aujourd'hui");
    if (j.poles.length === 0) {
      line(
        "Aucune activité enregistrée sur cette journée : aucune tâche terminée, aucun commentaire, aucune action tracée.",
        7,
        0,
        GREY,
      );
      y += 2;
    } else {
      for (const pole of j.poles) {
        ensure(10);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.8);
        doc.setTextColor(...NAVY);
        doc.text(txt(pole.pole).toUpperCase(), M, y);
        y += 3.8;
        for (const p of pole.personnes) {
          const evts = niveau >= 2 ? p.evenements.slice(0, maxEvents) : p.evenements;
          const reste = p.evenements.length - evts.length;
          line(`${txt(p.nom)}`, 7, 2, NAVY_SOFT, true);
          for (const e of evts) line(`${e.heure}  ${e.texte}`, 6.6, 6, [60, 68, 80]);
          if (reste > 0) line(`... et ${reste} autre(s) action(s)`, 6.4, 6, GREY);
        }
        y += 1.6;
      }
    }

    // ---------- 6. Échanges du jour ----------
    if (j.echanges.length > 0) {
      sectionTitle("Échanges internes du jour");
      const affiches = j.echanges.slice(0, maxEchanges);
      for (const t of affiches) {
        line(`${txt(t.titre)}  (${txt(t.pole)})`, 6.8, 0, NAVY_SOFT, true);
        for (const l of t.lignes) line(l, 6.4, 4, [72, 80, 92]);
        y += 1;
      }
      const masquees = j.echanges.length - affiches.length;
      if (masquees > 0)
        line(`${masquees} autre(s) tâche(s) commentée(s) non affichée(s), faute de place.`, 6.4, 0, GREY);
      y += 1.5;
    } else {
      line("Aucun commentaire interne posté aujourd'hui.", 6.8, 0, GREY);
      y += 1.5;
    }

    // ---------- 7. Présence ----------
    sectionTitle("Temps de connexion");
    if (j.presence.length === 0) {
      line("Aucune connexion enregistrée aujourd'hui.", 6.8, 0, GREY);
    } else if (niveau >= 1) {
      line(
        `${j.presence.length} personne(s) connectée(s) · temps cumulé ${txt(digest.synthese?.tempsCumule, "0 min")}`,
        6.8,
      );
    } else {
      for (const p of j.presence)
        line(`${txt(p.nom)} — ${txt(p.duree, "0 min")} · ${txt(p.plage, "—")}`, 6.8);
    }
    if (j.absents.length > 0)
      line(`Sans connexion aujourd'hui : ${j.absents.join(", ")}`, 6.4, 0, GREY);

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

    return { doc, pages: total };
  };

  // ---------- Garde-fou 2 pages ----------
  const reductions: string[] = [];
  let result = render(0, 99, j.echanges.length);
  if (result.pages > 2) {
    result = render(1, 99, j.echanges.length);
    reductions.push("présence résumée");
  }
  let maxEch = j.echanges.length;
  while (result.pages > 2 && maxEch > 0) {
    maxEch -= 1;
    result = render(1, 99, maxEch);
  }
  if (maxEch < j.echanges.length) reductions.push(`échanges limités à ${maxEch} tâches`);
  let maxEv = 12;
  while (result.pages > 2 && maxEv > 1) {
    maxEv -= 2;
    result = render(2, maxEv, maxEch);
  }
  if (result.pages <= 2 && maxEv < 12) reductions.push(`actions limitées à ${maxEv} par personne`);

  const out = new Uint8Array(result.doc.output("arraybuffer") as ArrayBuffer);
  console.log(
    `[pdf] genere en ${Date.now() - t0}ms (${result.pages} pages, ${Math.round(out.byteLength / 1024)} Ko)` +
      (reductions.length ? ` — reductions: ${reductions.join(", ")}` : " — aucune reduction"),
  );
  return out;
}

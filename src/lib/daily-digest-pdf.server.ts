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

/**
 * Palette sobre par pôle : teintes désaturées compatibles navy/or.
 * Chaque entrée = [filet foncé, aplat clair]. La couleur est dérivée de
 * l'identifiant du pôle (hash déterministe) : elle ne change pas d'un jour à l'autre.
 */
const POLE_PALETTE: { trait: [number, number, number]; fond: [number, number, number] }[] = [
  { trait: [42, 74, 112], fond: [233, 238, 245] },
  { trait: [58, 96, 84], fond: [233, 242, 238] },
  { trait: [124, 92, 44], fond: [247, 241, 229] },
  { trait: [104, 62, 74], fond: [246, 235, 238] },
  { trait: [70, 74, 112], fond: [237, 238, 247] },
  { trait: [86, 84, 60], fond: [244, 243, 233] },
];
const POLE_NEUTRE = { trait: [110, 118, 130] as [number, number, number], fond: [240, 242, 245] as [number, number, number] };

function poleColors(poleId: string | null | undefined) {
  if (!poleId) return POLE_NEUTRE;
  let h = 0;
  for (let i = 0; i < poleId.length; i++) h = (h * 31 + poleId.charCodeAt(i)) >>> 0;
  return POLE_PALETTE[h % POLE_PALETTE.length];
}

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
    messagerie: [],
    piecesJointes: [],
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
  const render = (niveau: number, maxEvents: number, maxEchanges: number, avecPieces = false) => {
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

    /**
     * Affiche un message et, s'il contient une adresse web (Drive, site…),
     * ajoute la ligne du lien en bleu, cliquable dans le PDF.
     */
    const lineAvecLiens = (
      text: string,
      size = 6.4,
      indent = 0,
      color: [number, number, number] = [96, 104, 116],
    ) => {
      const liens = [...new Set((text.match(/https?:\/\/[^\s<>"»)]+/gi) ?? []).map((u) => u.replace(/[.,;]+$/, "")))];
      line(text, size, indent, color);
      for (const u of liens) {
        const yLigne = y;
        line(u, size, indent + 4, [26, 86, 160]);
        doc.link(M + indent + 4, yLigne - size * 0.36, contentW - indent - 4, size * 0.5 + 1, { url: u });
      }
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
      y += 3.2;
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
        const col = poleColors((pole as any).poleId);
        ensure(12);
        // Bandeau du pôle : aplat clair + filet coloré, texte foncé (contraste élevé).
        doc.setFillColor(...col.fond);
        doc.rect(M, y - 3.2, contentW, 5.6, "F");
        doc.setFillColor(...col.trait);
        doc.rect(M, y - 3.2, 1.4, 5.6, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.6);
        doc.setTextColor(...col.trait);
        doc.text(txt(pole.pole).toUpperCase(), M + 3.6, y + 0.4);
        doc.setTextColor(40, 46, 56);
        y += 5.4;
        for (const p of pole.personnes) {
          const evts = niveau >= 2 ? p.evenements.slice(0, maxEvents) : p.evenements;
          const reste = p.evenements.length - evts.length;
          line(`${txt(p.nom)}`, 7, 3, NAVY_SOFT, true);
          for (const e of evts) {
            const yLigne = y;
            line(`${e.heure}   ${e.texte}`, 6.6, 8, [60, 68, 80]);
            // Pastille de pôle devant la ligne.
            doc.setFillColor(...col.trait);
            doc.circle(M + 4.6, yLigne - 0.9, 0.7, "F");
          }
          if (reste > 0) line(`... et ${reste} autre(s) action(s)`, 6.4, 8, GREY);
          y += 0.8;
        }
        y += 2;
      }
    }

    // ---------- 6. Échanges du jour ----------
    sectionTitle("Échanges internes du jour");
    if (j.echanges.length > 0) {
      const affiches = j.echanges.slice(0, maxEchanges);
      for (const t of affiches) {
        const col = poleColors((t as any).poleId);
        const yTitre = y;
        line(`${txt(t.titre)}  (${txt(t.pole)})`, 6.8, 5, NAVY_SOFT, true);
        doc.setFillColor(...col.trait);
        doc.circle(M + 1.6, yTitre - 0.9, 0.9, "F");
        for (const l of t.lignes) line(l, 6.4, 9, [72, 80, 92]);
        y += 1.6;
      }
      const masquees = j.echanges.length - affiches.length;
      if (masquees > 0)
        line(`${masquees} autre(s) tâche(s) commentée(s) non affichée(s), faute de place.`, 6.4, 0, GREY);
      y += 1.5;
    } else {
      line("Aucun commentaire interne posté aujourd'hui.", 6.8, 0, GREY);
      y += 1.5;
    }

    // ---------- 6 bis. Messagerie : qui a écrit à qui ----------
    sectionTitle("Messagerie du jour — qui écrit à qui");
    const canaux = j.messagerie ?? [];
    if (canaux.length === 0) {
      line("Aucun message échangé aujourd'hui.", 6.8, 0, GREY);
      y += 1.5;
    } else {
      const maxCanaux = niveau >= 2 ? 5 : niveau >= 1 ? 8 : 12;
      const maxLignes = niveau >= 2 ? 3 : niveau >= 1 ? 5 : 8;
      for (const c of canaux.slice(0, maxCanaux)) {
        ensure(12);
        line(`${txt(c.canal)}  —  ${c.total} message(s)`, 6.8, 5, NAVY_SOFT, true);
        if (c.participants) line(txt(c.participants), 6.3, 9, GREY);
        for (const l of c.lignes.slice(0, maxLignes)) {
          // « 14:32 — Marie → Client : « texte » » -> entête sur une ligne, message en dessous.
          const brut = txt(l);
          const sep = brut.indexOf(" : «");
          const entete = sep > 0 ? brut.slice(0, sep) : brut;
          const corps = sep > 0 ? brut.slice(sep + 3).trim().replace(/^«\s*/, "").replace(/\s*»$/, "") : "";
          line(entete, 6.4, 9, [72, 80, 92], true);
          if (corps) line(`« ${corps} »`, 6.4, 13, [96, 104, 116]);
        }
        const reste = c.total - Math.min(c.lignes.length, maxLignes);
        if (reste > 0) line(`... et ${reste} autre(s) message(s) dans ce fil`, 6.2, 9, GREY);
        y += 1.6;
      }
      const autres = canaux.length - Math.min(canaux.length, maxCanaux);
      if (autres > 0) line(`${autres} autre(s) fil(s) de discussion non détaillé(s), faute de place.`, 6.4, 0, GREY);

      y += 1.5;
    }

    // ---------- 6 ter. Pièces jointes du jour ----------
    // Cette section n'est dessinée qu'au rendu final : les images coûtent cher
    // à réencoder, et le garde-fou relance le rendu plusieurs fois.
    if (avecPieces) {
      doc.addPage();
      y = M;
      sectionTitle("Pièces jointes du jour");
      const pieces = j.piecesJointes ?? [];
      if (pieces.length === 0) {
        line("Aucune pièce jointe échangée aujourd'hui.", 6.8, 0, GREY);
        y += 1.5;
      } else {
        const vignettes = pieces.filter((p) => p.dataUrl && p.format);
        const sansApercu = pieces.filter((p) => !(p.dataUrl && p.format));

        // Deux colonnes : l'image est lisible directement dans le compte rendu.
        const COLS = 2;
        const GAP = 5;
        const cellW = (contentW - GAP * (COLS - 1)) / COLS;
        const boxH = 62;
        const capH = 10;
        /** Tronque à la largeur voulue avec une ellipse, police courante. */
        const court = (t: string, largeur: number): string => {
          let v = txt(t);
          if (doc.getTextWidth(v) <= largeur) return v;
          while (v.length > 1 && doc.getTextWidth(`${v}…`) > largeur) v = v.slice(0, -1);
          return `${v}…`;
        };

        // Deux messages peuvent porter le même fichier : un alias par image distincte
        // évite de le stocker plusieurs fois dans le PDF.
        const alias = new Map<string, string>();
        for (let i = 0; i < vignettes.length; i += COLS) {
          const rangee = vignettes.slice(i, i + COLS);
          ensure(boxH + capH + 2);
          const yTop = y;
          rangee.forEach((p, k) => {
            const x = M + k * (cellW + GAP);
            doc.setDrawColor(226, 230, 236);
            doc.setLineWidth(0.3);
            doc.setFillColor(...LIGHT);
            doc.roundedRect(x, yTop, cellW, boxH, 1.2, 1.2, "FD");
            try {
              // On respecte le rapport hauteur/largeur pour ne pas déformer l'image.
              const props = doc.getImageProperties(p.dataUrl as string);
              const ratio = props.width / props.height;
              let w = cellW - 3;
              let h = w / ratio;
              if (h > boxH - 3) {
                h = boxH - 3;
                w = h * ratio;
              }
              const cle = p.dataUrl as string;
              if (!alias.has(cle)) alias.set(cle, `pj${alias.size}`);
              doc.addImage(
                cle,
                p.format as string,
                x + (cellW - w) / 2,
                yTop + (boxH - h) / 2,
                w,
                h,
                alias.get(cle),
                "FAST",
              );
            } catch {
              // Image refusée par jsPDF : le cadre reste vide, la légende suffit.
              doc.setFont("helvetica", "italic");
              doc.setFontSize(6);
              doc.setTextColor(...GREY);
              doc.text("aperçu indisponible", x + cellW / 2, yTop + boxH / 2, { align: "center" });
            }
            // Trois lignes distinctes : sur une seule, le nom du fichier disparaissait.
            doc.setFont("helvetica", "bold");
            doc.setFontSize(6);
            doc.setTextColor(72, 80, 92);
            doc.text(court(`${p.heure} — ${p.auteur}`, cellW), x, yTop + boxH + 3.2);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(...GREY);
            doc.text(court(p.canal, cellW), x, yTop + boxH + 5.9);
            doc.setTextColor(96, 104, 116);
            doc.text(court(p.nom, cellW), x, yTop + boxH + 8.6);
          });
          y = yTop + boxH + capH + 2;
          doc.setFont("helvetica", "normal");
          doc.setTextColor(40, 46, 56);
        }

        if (sansApercu.length > 0) {
          y += 2;
          line("Autres fichiers déposés aujourd'hui (PDF, Word, tableurs…) :", 6.6, 0, NAVY_SOFT, true);
          for (const p of sansApercu) {
            line(
              `${txt(p.heure)} — ${txt(p.auteur)} — ${txt(p.canal)} · ${txt(p.nom)}`,
              6.4,
              5,
              [72, 80, 92],
            );
          }
        }

        y += 1.5;
      }
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

  // ---------- Garde-fou 3 pages (hors pièces jointes, ajoutées ensuite) ----------
  // Le calibrage se fait sans les images : les réencoder à chaque passe coûtait
  // près d'une minute et faisait échouer la génération.
  const reductions: string[] = [];
  let niveau = 0;
  let result = render(0, 99, j.echanges.length);
  if (result.pages > 3) {
    niveau = 1;
    result = render(1, 99, j.echanges.length);
    reductions.push("présence résumée");
  }
  let maxEch = j.echanges.length;
  for (const essai of [20, 10, 5, 2, 0]) {
    if (result.pages <= 3 || essai >= maxEch) continue;
    maxEch = essai;
    result = render(niveau, 99, maxEch);
  }
  if (maxEch < j.echanges.length) reductions.push(`échanges limités à ${maxEch} tâches`);
  let maxEv = 12;
  for (const essai of [8, 5, 3, 2]) {
    if (result.pages <= 3) break;
    niveau = 2;
    maxEv = essai;
    result = render(2, maxEv, maxEch);
  }
  if (result.pages <= 3 && maxEv < 12) reductions.push(`actions limitées à ${maxEv} par personne`);

  // Rendu final : mêmes réglages, avec la page des pièces jointes.
  result = render(niveau, maxEv, maxEch, true);


  const out = new Uint8Array(result.doc.output("arraybuffer") as ArrayBuffer);
  console.log(
    `[pdf] genere en ${Date.now() - t0}ms (${result.pages} pages, ${Math.round(out.byteLength / 1024)} Ko)` +
      (reductions.length ? ` — reductions: ${reductions.join(", ")}` : " — aucune reduction"),
  );
  return out;
}

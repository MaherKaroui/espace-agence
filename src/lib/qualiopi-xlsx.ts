import * as XLSX from "xlsx";

/** Normalise : minuscules, sans accents, espaces compactés. */
export const normalizeKey = (s: unknown) =>
  (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  return String(v).trim();
};

export const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];
const MONTH_INDEX = new Map<string, number>(MONTHS_FR.map((m, i) => [normalizeKey(m), i]));

export const PENDING_SHEET_NAME = "Demande En cours";
export const PENDING_HEADER_ROW = 4; // 1-indexed : en-têtes ligne 4, données ligne 5
export const MONTH_HEADER_ROW = 3; // 1-indexed : en-têtes ligne 3, données ligne 4

export const PENDING_HEADERS = ["Tuteur", "Organisme de Formation", "Formation", "Certificateur", "Observation", "date"];
export const MONTH_HEADERS = [
  "Tuteur", "Date", "Jour", "Organisme de Formation", "FORMATION",
  "Nom de l'auditeur", "Certificateur", "Certificat", "Notes de suivi",
];

const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
export function jourFr(dateStr?: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  return JOURS[d.getDay()] ?? "";
}

/** Numéro de série Excel (base 30/12/1899) ou texte de date → ISO yyyy-mm-dd. */
export function toIso(raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "";
  if (raw instanceof Date) {
    const d = raw;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (typeof raw === "number" || /^\d+([.,]\d+)?$/.test(String(raw).trim())) {
    const serial = typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
      // base Excel : 30/12/1899
      const base = Date.UTC(1899, 11, 30);
      const d = new Date(base + Math.floor(serial) * 86400000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
    return "";
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  }
  return "";
}

/** Champs cibles ← libellés d'en-tête acceptés (normalisés). */
const HEADER_ALIASES: Record<string, string[]> = {
  tuteur: ["tuteur", "tuteurs", "pilote"],
  audit_date: ["date", "date d'audit", "date audit"],
  jour: ["jour"],
  organism_name: ["organisme de formation", "organisme", "of", "nom de l'organisme"],
  formation: ["formation", "type de formation"],
  auditor_name: ["nom de l'auditeur", "auditeur", "nom auditeur"],
  certifier_name: ["certificateur", "organisme certificateur"],
  certificate_status: ["certificat", "statut certificat"],
  notes_suivi: ["notes de suivi", "note de suivi", "notes", "suivi"],
  observation: ["observation", "observations"],
};

type ColumnMap = { byField: Record<string, number>; unknown: string[] };

/** Mappe les colonnes PAR NOM D'EN-TÊTE (jamais par position). */
export function mapHeaderRow(headerCells: unknown[]): ColumnMap {
  const byField: Record<string, number> = {};
  const unknown: string[] = [];
  headerCells.forEach((raw, idx) => {
    const label = cell(raw);
    if (!label) return;
    const n = normalizeKey(label);
    const field = Object.keys(HEADER_ALIASES).find((f) => HEADER_ALIASES[f].includes(n));
    if (!field) { unknown.push(label); return; }
    if (byField[field] === undefined) byField[field] = idx;
  });
  return { byField, unknown };
}

export type ParsedRow = {
  sheet: string;
  tuteur: string | null;
  audit_date: string | null;
  organism_name: string;
  formation: string | null;
  auditor_name: string | null;
  certifier_name: string | null;
  certificate_status: string | null;
  notes_suivi: string | null;
  observation: string | null;
};

export type SheetReport = {
  sheet: string;
  kind: "demandes" | "mois" | "inconnue";
  rowsRead: number;
  kept: number;
  skipped: Array<{ reason: string; count: number }>;
  unknownColumns: string[];
  missingColumns: string[];
};

export type ParseResult = {
  rows: ParsedRow[];
  sheets: SheetReport[];
  problems: string[];
};

function pick(map: Record<string, number>, row: unknown[], field: string): string {
  const idx = map[field];
  if (idx === undefined) return "";
  return cell(row[idx]);
}

/** Lit le classeur « Calendrier Qualiopi » : feuille de demandes + feuilles mensuelles. */
export function parseQualiopiWorkbook(buf: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const rows: ParsedRow[] = [];
  const sheets: SheetReport[] = [];
  const problems: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true, blankrows: true });
    const sn = normalizeKey(sheetName);
    const isPending = sn.includes("demande");
    const monthIdx = MONTH_INDEX.get(sn);
    if (!isPending && monthIdx === undefined) {
      sheets.push({ sheet: sheetName, kind: "inconnue", rowsRead: grid.length, kept: 0, skipped: [{ reason: "Feuille non reconnue (ni « Demande En cours » ni un mois en français)", count: grid.length }], unknownColumns: [], missingColumns: [] });
      continue;
    }

    const expectedHeaderIdx = (isPending ? PENDING_HEADER_ROW : MONTH_HEADER_ROW) - 1;
    // Tolérance : on cherche la ligne d'en-tête autour de la position attendue.
    let headerIdx = -1;
    const candidates = [expectedHeaderIdx, ...Array.from({ length: 12 }, (_, i) => i)];
    for (const i of candidates) {
      const map = mapHeaderRow(grid[i] ?? []);
      if (map.byField["organism_name"] !== undefined) { headerIdx = i; break; }
    }
    if (headerIdx === -1) {
      problems.push(`Feuille « ${sheetName} » : aucune ligne d'en-tête contenant « Organisme de Formation » (attendue en ligne ${expectedHeaderIdx + 1}).`);
      sheets.push({ sheet: sheetName, kind: isPending ? "demandes" : "mois", rowsRead: grid.length, kept: 0, skipped: [{ reason: "En-têtes introuvables", count: grid.length }], unknownColumns: [], missingColumns: ["Organisme de Formation"] });
      continue;
    }

    const map = mapHeaderRow(grid[headerIdx] ?? []);
    const expectedFields = isPending
      ? ["tuteur", "organism_name", "formation", "certifier_name", "observation"]
      : ["tuteur", "audit_date", "organism_name", "formation", "auditor_name", "certifier_name", "certificate_status", "notes_suivi"];
    const missing = expectedFields.filter((f) => map.byField[f] === undefined).map((f) => HEADER_ALIASES[f][0]);

    const skipped = new Map<string, number>();
    const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
    let kept = 0;
    let rowsRead = 0;

    for (let i = headerIdx + 1; i < grid.length; i++) {
      const row = grid[i] ?? [];
      const hasAnything = row.some((c) => cell(c) !== "");
      if (!hasAnything) continue;
      rowsRead++;

      const org = pick(map.byField, row, "organism_name");
      const iso = isPending ? "" : toIso(map.byField["audit_date"] !== undefined ? row[map.byField["audit_date"]] : "");

      if (!org) {
        skip(iso ? "Case de calendrier sans organisme (ligne vide du planning)" : "Ligne sans organisme de formation");
        continue;
      }
      if (!isPending && !iso) {
        skip("Date d'audit illisible ou absente");
        continue;
      }

      rows.push({
        sheet: sheetName,
        tuteur: pick(map.byField, row, "tuteur") || null,
        audit_date: isPending ? null : iso,
        organism_name: org,
        formation: pick(map.byField, row, "formation") || null,
        auditor_name: pick(map.byField, row, "auditor_name") || null,
        certifier_name: pick(map.byField, row, "certifier_name") || null,
        certificate_status: pick(map.byField, row, "certificate_status") || null,
        notes_suivi: pick(map.byField, row, "notes_suivi") || null,
        observation: pick(map.byField, row, "observation") || null,
      });
      kept++;
    }

    sheets.push({
      sheet: sheetName,
      kind: isPending ? "demandes" : "mois",
      rowsRead,
      kept,
      skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
      unknownColumns: map.unknown,
      missingColumns: missing,
    });
  }

  if (sheets.length === 0) problems.push("Le fichier ne contient aucune feuille exploitable.");
  if (!sheets.some((s) => s.kind === "demandes")) {
    problems.push(`Feuille « ${PENDING_SHEET_NAME} » absente : les demandes sans date d'audit ne seront pas importées.`);
  }

  return { rows, sheets, problems };
}

export type ExportEvent = {
  tuteur?: string | null;
  audit_date?: string | null;
  organism_name: string;
  formation?: string | null;
  auditor_name?: string | null;
  certifier_name?: string | null;
  certifier_organization?: string | null;
  certificate_status?: string | null;
  notes_suivi?: string | null;
  observation?: string | null;
};

/** Produit un classeur identique au modèle (mêmes feuilles, en-têtes et lignes d'en-tête). */
export function buildQualiopiWorkbook(events: ExportEvent[], year: number): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const pendingRows: unknown[][] = [];
  for (let i = 0; i < PENDING_HEADER_ROW - 1; i++) pendingRows.push([]);
  pendingRows.push([...PENDING_HEADERS]);
  events
    .filter((e) => !e.audit_date)
    .forEach((e) => pendingRows.push([
      e.tuteur ?? "",
      e.organism_name ?? "",
      e.formation ?? "",
      e.certifier_name ?? e.certifier_organization ?? "",
      e.observation ?? "",
      "",
    ]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pendingRows), PENDING_SHEET_NAME);

  const dated = events.filter((e) => !!e.audit_date);
  const monthsUsed = new Set(dated.map((e) => Number(e.audit_date!.slice(5, 7)) - 1));
  const monthList = [...monthsUsed].sort((a, b) => a - b);
  for (const m of monthList) {
    const rows: unknown[][] = [];
    for (let i = 0; i < MONTH_HEADER_ROW - 1; i++) rows.push([]);
    rows.push([...MONTH_HEADERS]);
    dated
      .filter((e) => Number(e.audit_date!.slice(5, 7)) - 1 === m)
      .sort((a, b) => a.audit_date!.localeCompare(b.audit_date!))
      .forEach((e) => rows.push([
        e.tuteur ?? "",
        e.audit_date ?? "",
        jourFr(e.audit_date),
        e.organism_name ?? "",
        e.formation ?? "",
        e.auditor_name ?? "",
        e.certifier_name ?? e.certifier_organization ?? "",
        e.certificate_status ?? "",
        e.notes_suivi ?? "",
      ]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), MONTHS_FR[m]);
  }

  if (monthList.length === 0) {
    const rows: unknown[][] = [];
    for (let i = 0; i < MONTH_HEADER_ROW - 1; i++) rows.push([]);
    rows.push([...MONTH_HEADERS]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), MONTHS_FR[new Date().getMonth()]);
  }

  void year;
  return wb;
}

export function downloadQualiopiWorkbook(events: ExportEvent[], year: number) {
  const wb = buildQualiopiWorkbook(events, year);
  XLSX.writeFile(wb, `Calendrier_Qualiopi_${year}.xlsx`);
}

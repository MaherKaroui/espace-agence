import * as XLSX from "xlsx";

export type ParsedEvent = {
  audit_date: string;
  organism_name: string;
  formation: string | null;
  auditor_name: string | null;
  certifier_name: string | null;
  certificate_status: string | null;
};

export type ParsedPending = {
  organism_name: string;
  certifier: string | null;
  observation: string | null;
  followup_status: string;
};

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

const toIso = (raw: unknown): string => {
  if (raw === null || raw === undefined || raw === "") return "";
  if (raw instanceof Date) {
    const d = raw;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (typeof raw === "number") {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
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
};

const SECTION_TITLES = new Set([
  "recuperation certif",
  "recuperation certificat",
  "planification en cours",
  "planification",
  "demande en cours",
]);

const followupFromObservation = (obs: string): string => {
  const n = normalizeKey(obs);
  if (n.includes("contrat")) return "attente_contrat";
  if (n.includes("paiement")) return "attente_paiement";
  if (n.includes("facture")) return "attente_facture";
  if (n.includes("doc")) return "attente_docs";
  if (n.includes("certificateur")) return "attente_retour_certificateur";
  if (n.includes("certif")) return "recuperation_certificat";
  return "autre";
};

/** Parses the "Calendrier Qualiopi" workbook (monthly sheets + "Demande En cours"). */
export function parseQualiopiWorkbook(buf: ArrayBuffer): { events: ParsedEvent[]; pendings: ParsedPending[] } {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const events: ParsedEvent[] = [];
  const pendings: ParsedPending[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: true });
    if (!grid.length) continue;
    const sn = normalizeKey(sheetName);
    const isPendingSheet = sn.includes("demande") || sn.includes("en cours");

    // Locate header row
    let headerRow = -1;
    for (let i = 0; i < Math.min(grid.length, 15); i++) {
      const row = (grid[i] ?? []).map((c) => normalizeKey(c));
      const hasOrg = row.some((c) => c.startsWith("organisme"));
      if (!hasOrg) continue;
      if (isPendingSheet || row.some((c) => c === "date")) {
        headerRow = i;
        break;
      }
    }
    if (headerRow === -1) continue;

    const header = (grid[headerRow] ?? []).map((c) => normalizeKey(c));
    const findCol = (...names: string[]) =>
      header.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));

    if (isPendingSheet) {
      const cOrg = findCol("organisme");
      const cCert = findCol("certificateur");
      const cObs = findCol("observation");
      // Secondary block (e.g. "RÉCUPÉRATION CERTIF") = columns to the right of the main block
      const blockEnd = Math.max(cOrg, cCert, cObs);
      for (let i = headerRow + 1; i < grid.length; i++) {
        const row = grid[i] ?? [];
        const org = cell(row[cOrg]);
        if (org && !SECTION_TITLES.has(normalizeKey(org))) {
          const obs = cObs >= 0 ? cell(row[cObs]) : "";
          pendings.push({
            organism_name: org,
            certifier: (cCert >= 0 ? cell(row[cCert]) : "") || null,
            observation: obs || null,
            followup_status: followupFromObservation(obs),
          });
        }
        // extra right-side block
        for (let c = blockEnd + 1; c < row.length; c++) {
          const v = cell(row[c]);
          if (!v || SECTION_TITLES.has(normalizeKey(v))) continue;
          const next = cell(row[c + 1]);
          pendings.push({
            organism_name: v,
            certifier: null,
            observation: next || null,
            followup_status: "recuperation_certificat",
          });
          c += 1;
        }
      }
      continue;
    }

    // Monthly sheet
    const cDate = findCol("date");
    const cOrg = findCol("organisme");
    const cForm = findCol("formation");
    const cAud = findCol("nom de l'auditeur", "auditeur");
    const cCert = findCol("certificateur");
    const cStat = findCol("certificat");
    let currentDate = "";
    for (let i = headerRow + 1; i < grid.length; i++) {
      const row = grid[i] ?? [];
      const iso = toIso(row[cDate]);
      if (iso) currentDate = iso;
      const org = cOrg >= 0 ? cell(row[cOrg]) : "";
      const formation = cForm >= 0 ? cell(row[cForm]) : "";
      const auditor = cAud >= 0 ? cell(row[cAud]) : "";
      const certifier = cCert >= 0 ? cell(row[cCert]) : "";
      if (!currentDate) continue;
      if (!org && !formation && !auditor && !certifier) continue;
      if (!org) continue;
      events.push({
        audit_date: currentDate,
        organism_name: org,
        formation: formation || null,
        auditor_name: auditor || null,
        certifier_name: certifier || null,
        certificate_status: (cStat >= 0 ? cell(row[cStat]) : "") || null,
      });
    }
  }

  return { events, pendings };
}

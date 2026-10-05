/**
 * Demandes et relances de certificat Qualiopi auprès des certificateurs.
 * Partagé client / serveur : annuaire des certificateurs, lecture de la ligne
 * du calendrier et rédaction automatique des e-mails selon l'organisme.
 */

export type CertMailKind = "demande" | "relance";

export type CertifierKey = "bci" | "capcert" | "qualipro";

export type CertifierContact = { email: string; label: string };

export const CERTIFIER_DIRECTORY: Record<CertifierKey, { label: string; contacts: CertifierContact[] }> = {
  bci: {
    label: "BCI France",
    contacts: [
      { email: "contact@bcifrance.fr", label: "Contact général" },
      { email: "hafida@bcifrance.fr", label: "Hafida" },
      { email: "cassandra@bcifrance.fr", label: "Cassandra" },
      { email: "soan@bcifrance.fr", label: "Soan" },
    ],
  },
  capcert: {
    label: "CAPCERT",
    contacts: [
      { email: "contact@capcertification.com", label: "Contact général" },
      { email: "theo.roederer@capcertification.com", label: "Théo Roederer" },
    ],
  },
  qualipro: {
    label: "QUALIPRO",
    contacts: [{ email: "contact@qualiprocertification.fr", label: "Contact général" }],
  },
};

function norm(s?: string | null): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Certificateur(s) reconnu(s) dans la saisie libre (« BCI - capcert », « QUALIRPO »…). */
export function detectCertifiers(...values: Array<string | null | undefined>): CertifierKey[] {
  const c = norm(values.join(" ")).replace(/\s+/g, "");
  const found: CertifierKey[] = [];
  if (c.includes("bci")) found.push("bci");
  if (c.includes("capcert")) found.push("capcert");
  if (c.includes("qualipro") || c.includes("qualirpo")) found.push("qualipro");
  return found;
}

/** Destinataires proposés par défaut : l'adresse de contact du certificateur. */
export function defaultRecipients(keys: CertifierKey[]): string[] {
  return keys.map((k) => CERTIFIER_DIRECTORY[k].contacts[0]!.email);
}

const CATEGORIES: Array<{ re: RegExp; label: string }> = [
  { re: /\baf\b/, label: "actions de formation" },
  { re: /\bbc\b|bilan/, label: "bilans de compétences" },
  { re: /\bvae\b/, label: "actions permettant de faire valider les acquis de l'expérience" },
  { re: /\bcfa\b|apprenti/, label: "actions de formation par apprentissage" },
];

/** Lit le champ « Formation » : catégories d'actions + type d'audit. */
export function parseFormation(formation?: string | null) {
  const f = norm(formation).replace(/[-_/;,]+/g, " ");
  const categories = CATEGORIES.filter((c) => c.re.test(f)).map((c) => c.label);
  let auditType: string | null = null;
  if (/surveill/.test(f)) auditType = "audit de surveillance";
  else if (/renouvel/.test(f)) auditType = "audit de renouvellement";
  else if (/extension/.test(f)) auditType = "audit d'extension";
  else if (/initi?al/.test(f)) auditType = "audit initial";
  return { categories, auditType };
}

function joinFr(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}

function capitalizeName(s?: string | null): string {
  return (s ?? "")
    .trim()
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function dateFr(iso?: string | null, withDay = false): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", withDay
    ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
    : { day: "2-digit", month: "2-digit", year: "numeric" });
}

/* ------------------------------------------------------------------ */
/* Historique : tenu dans « Notes de suivi », donc visible dans l'export */
/* ------------------------------------------------------------------ */

export type CertMailHistoryEntry = { date: string; kind: CertMailKind; rank: number; to: string };

const HISTORY_RE = /^\[Certificat\] (\d{2})\/(\d{2})\/(\d{4}) — (Demande|Relance n°(\d+)) envoyée à (.*)$/gm;

export function parseCertHistory(notes?: string | null): CertMailHistoryEntry[] {
  const out: CertMailHistoryEntry[] = [];
  for (const m of (notes ?? "").matchAll(HISTORY_RE)) {
    const kind: CertMailKind = m[4] === "Demande" ? "demande" : "relance";
    out.push({ date: `${m[3]}-${m[2]}-${m[1]}`, kind, rank: kind === "demande" ? 0 : Number(m[5]), to: m[6]! });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function historyLine(kind: CertMailKind, rank: number, recipients: string[], today = new Date()): string {
  const d = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;
  const what = kind === "demande" ? "Demande" : `Relance n°${rank}`;
  return `[Certificat] ${d} — ${what} envoyée à ${recipients.join(", ")}`;
}

export function daysSince(iso?: string | null, today = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((today.getTime() - d.getTime()) / 86_400_000);
}

/** Délai conseillé avant la relance suivante. */
export const RELANCE_DELAY_DAYS = 7;

/** Prochaine action suggérée pour une ligne du calendrier. */
export function nextCertAction(ev: { audit_date: string | null; notes_suivi: string | null }) {
  const history = parseCertHistory(ev.notes_suivi);
  const last = history[history.length - 1] ?? null;
  const kind: CertMailKind = history.length === 0 ? "demande" : "relance";
  const rank = history.filter((h) => h.kind === "relance").length + (kind === "relance" ? 1 : 0);
  const sinceLast = last ? daysSince(last.date) : null;
  const sinceAudit = daysSince(ev.audit_date);
  const due = last ? (sinceLast ?? 0) >= RELANCE_DELAY_DAYS : (sinceAudit ?? -1) >= 0;
  return { history, last, kind, rank, sinceLast, sinceAudit, due };
}

/* ------------------------------------------------------------------ */
/* Rédaction                                                           */
/* ------------------------------------------------------------------ */

export type CertMailEvent = {
  organism_name: string;
  formation: string | null;
  audit_date: string | null;
  auditor_name: string | null;
  certifier_name: string | null;
  certifier_organization: string | null;
  notes_suivi: string | null;
};

export type CertMailSender = { prenom?: string | null; nom?: string | null; email?: string | null; telephone?: string | null };

/** « Bonjour Hafida, » quand on écrit à une seule personne nommée, sinon « Bonjour, ». */
function greeting(recipients: string[]): string {
  if (recipients.length !== 1) return "Bonjour,";
  const email = recipients[0]!.toLowerCase();
  for (const k of Object.keys(CERTIFIER_DIRECTORY) as CertifierKey[]) {
    const c = CERTIFIER_DIRECTORY[k].contacts.find((x) => x.email === email);
    if (c && c.label !== "Contact général") return `Bonjour ${c.label.split(" ")[0]},`;
  }
  return "Bonjour,";
}

function signature(sender: CertMailSender): string {
  const name = [sender.prenom, sender.nom].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  return [name, sender.telephone?.trim(), sender.email?.trim()].filter(Boolean).join("\n");
}

export function buildCertMail(args: {
  kind: CertMailKind;
  rank: number;
  event: CertMailEvent;
  recipients: string[];
  sender: CertMailSender;
  today?: Date;
}): { subject: string; body: string } {
  const { kind, rank, event, recipients, sender } = args;
  const today = args.today ?? new Date();
  const of = event.organism_name.trim();
  const { categories, auditType } = parseFormation(event.formation);
  const auditor = capitalizeName(event.auditor_name);
  const audited = event.audit_date ? (daysSince(event.audit_date, today) ?? -1) >= 0 : false;
  const history = parseCertHistory(event.notes_suivi);
  const firstSent = history.find((h) => h.kind === "demande") ?? history[0];

  // Phrase d'identification de l'audit, construite avec les seules données connues
  const auditBits: string[] = [];
  auditBits.push(auditType ? `l'${auditType} Qualiopi` : "l'audit Qualiopi");
  if (event.audit_date) auditBits.push(`${audited ? "réalisé" : "prévu"} le ${dateFr(event.audit_date, true)}`);
  if (auditor) auditBits.push(`par ${auditor}`);
  // Sans le nom de l'organisme (relances, où il figure déjà dans la phrase d'ouverture)
  const auditPhrase = auditBits.join(" ");
  const [firstBit, ...restBits] = auditBits;
  const auditPhraseOf = [firstBit, `de l'organisme ${of}`, ...restBits].join(" ");
  const quoted = categories.map((c) => `« ${c} »`);
  const scope = quoted.length === 0 ? ""
    : quoted.length === 1 ? `, au titre de la catégorie ${quoted[0]}`
    : `, au titre des catégories ${joinFr(quoted)}`;

  const dateTag = event.audit_date ? ` — audit du ${dateFr(event.audit_date)}` : "";
  const lines: string[] = [greeting(recipients), ""];
  let subject: string;

  if (kind === "demande") {
    subject = `Demande de certificat Qualiopi — ${of}${dateTag}`;
    lines.push(`Je me permets de revenir vers vous au sujet de ${auditPhraseOf}${scope}.`);
    lines.push("");
    if (audited) {
      lines.push("Sauf erreur de notre part, nous n'avons pas encore reçu le certificat correspondant. Pourriez-vous nous le transmettre au format PDF dès qu'il sera émis, en nous précisant son numéro et sa période de validité ?");
    } else {
      lines.push("Pourriez-vous nous indiquer les modalités et le délai de délivrance du certificat à l'issue de cet audit, afin que nous puissions anticiper sa transmission à l'organisme ?");
    }
    lines.push("");
    lines.push("Si un élément reste attendu de notre côté pour finaliser la décision de certification (levée d'écart, document complémentaire, règlement), merci de nous le signaler : nous ferons le nécessaire rapidement.");
  } else if (rank <= 1) {
    subject = `Relance — certificat Qualiopi ${of}${dateTag}`;
    lines.push(`Je me permets de vous relancer concernant le certificat Qualiopi de l'organisme ${of}${firstSent ? `, que nous vous avons demandé le ${dateFr(firstSent.date)}` : ""}.`);
    lines.push("");
    lines.push(`Pour rappel, il s'agit de ${auditPhrase}${scope}.`);
    lines.push("");
    lines.push("Pourriez-vous nous faire savoir où en est la décision de certification et, le cas échéant, nous adresser le certificat au format PDF ?");
  } else {
    subject = `${rank}e relance — certificat Qualiopi ${of}${dateTag}`;
    const since = event.audit_date && audited ? daysSince(event.audit_date, today) : null;
    lines.push(`Malgré nos précédents messages${firstSent ? ` (première demande le ${dateFr(firstSent.date)})` : ""}, nous n'avons toujours pas reçu le certificat Qualiopi de l'organisme ${of}.`);
    lines.push("");
    lines.push(`Il s'agit de ${auditPhrase}${scope}${since !== null ? `, soit il y a ${since} jours` : ""}.`);
    lines.push("");
    lines.push("Ce certificat conditionne l'accès de l'organisme aux financements publics et mutualisés ainsi que la mise à jour de ses supports de communication. Pourriez-vous nous indiquer une date de délivrance, ou à défaut l'élément qui bloque la décision ?");
  }

  lines.push("");
  lines.push("Je vous remercie par avance et reste à votre disposition pour tout complément.");
  lines.push("");
  lines.push("Bien cordialement,");
  const sig = signature(sender);
  if (sig) lines.push(sig);

  return { subject, body: lines.join("\n") };
}

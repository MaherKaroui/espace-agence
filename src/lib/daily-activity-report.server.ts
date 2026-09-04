/**
 * Rapport d'activité quotidien (envoi 19h Europe/Paris, jours ouvrés).
 * Server-only : ne jamais importer depuis un composant.
 */
import { computeAnomalies, APP_URL } from "@/lib/supervision.server";

/** Décalage Europe/Paris en minutes pour un instant donné. */
function parisOffsetMinutes(at: Date): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    timeZoneName: "shortOffset",
  }).format(at);
  const m = /GMT([+-]\d+)(?::(\d+))?/.exec(s);
  if (!m) return 60;
  return Number(m[1]) * 60 + (m[1]!.startsWith("-") ? -Number(m[2] ?? 0) : Number(m[2] ?? 0));
}

/** Date du jour au format YYYY-MM-DD en Europe/Paris. */
export function parisDateKey(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(at);
}

/** Jour de la semaine en Europe/Paris ("Mon", "Sat", ...). */
export function parisWeekday(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", weekday: "short" }).format(at);
}

export function isParisWeekend(at: Date = new Date()): boolean {
  const d = parisWeekday(at);
  return d === "Sat" || d === "Sun";
}

/** Instant UTC correspondant à une heure locale Paris d'un jour donné. */
function parisInstant(dayKey: string, hour: number): Date {
  const naive = new Date(`${dayKey}T${String(hour).padStart(2, "0")}:00:00Z`);
  const off = parisOffsetMinutes(naive);
  return new Date(naive.getTime() - off * 60000);
}

export interface RecipientResolution {
  recipients: string[];
  adminEmail: string | null;
}

/** admin_email + report_recipients, dédoublonnés, hors adresses supprimées. */
export async function resolveReportRecipients(admin: any): Promise<RecipientResolution> {
  const { data: settings } = await admin
    .from("email_settings")
    .select("admin_email, report_recipients")
    .eq("id", 1)
    .maybeSingle();

  const list = [
    settings?.admin_email,
    ...((settings?.report_recipients ?? []) as string[]),
  ]
    .filter((e): e is string => typeof e === "string" && e.includes("@"))
    .map((e) => e.trim().toLowerCase());

  const unique = [...new Set(list)];
  if (unique.length === 0) return { recipients: [], adminEmail: settings?.admin_email ?? null };

  const { data: suppressed } = await admin
    .from("suppressed_emails")
    .select("email")
    .in("email", unique);
  const blocked = new Set(((suppressed ?? []) as any[]).map((r) => String(r.email).toLowerCase()));

  return {
    recipients: unique.filter((e) => !blocked.has(e)),
    adminEmail: settings?.admin_email ?? null,
  };
}

export interface DailyActivityReport {
  periode: string;
  synthese: Record<string, number>;
  membres: {
    nom: string;
    done: number;
    inProgress: number;
    overdue: number;
    completionRate: number;
    contexts: string[];
    doneTitles: string[];
  }[];
  attention: { label: string; count: number; gravite: string }[];
  demain: { echeances: string[]; rdv: string[] };
}

/** Agrégation du rapport pour la journée en cours (Europe/Paris). */
export async function buildDailyActivityReport(admin: any): Promise<DailyActivityReport> {
  const now = new Date();
  const dayKey = parisDateKey(now);

  // Toujours la journée en cours : de 00h00 (Paris) à maintenant.
  const from = parisInstant(dayKey, 0);
  const to = now;
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const periode = now.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });


  const count = async (table: string, build: (q: any) => any) => {
    try {
      const { count: c, error } = await build(
        admin.from(table).select("id", { count: "exact", head: true }),
      );
      if (error) {
        console.error("[rapport-activite] count failed", table, error.message);
        return 0;
      }
      return c ?? 0;
    } catch (e) {
      console.error("[rapport-activite] count exception", table, e);
      return 0;
    }
  };

  const [
    dossiersCrees,
    documentsDeposes,
    messagesClient,
    messagesInternes,
    messagesGroupe,
    nouveauxClients,
    rdvTenus,
    rdvAVenir,
    changementsStatut,
  ] = await Promise.all([
    count("dossiers", (q: any) => q.gte("created_at", fromIso).lte("created_at", toIso)),
    count("documents", (q: any) =>
      q.gte("created_at", fromIso).lte("created_at", toIso).not("storage_path", "is", null),
    ),
    count("messages", (q: any) => q.gte("created_at", fromIso).lte("created_at", toIso)),
    count("internal_messages", (q: any) => q.gte("created_at", fromIso).lte("created_at", toIso)),
    count("group_messages", (q: any) => q.gte("created_at", fromIso).lte("created_at", toIso)),
    count("profiles", (q: any) => q.gte("created_at", fromIso).lte("created_at", toIso)),
    count("rendez_vous", (q: any) => q.gte("starts_at", fromIso).lte("starts_at", toIso)),
    count("rendez_vous", (q: any) => q.gt("starts_at", toIso)),
    count("audit_logs", (q: any) =>
      q.gte("created_at", fromIso).lte("created_at", toIso).eq("entity_type", "dossier"),
    ),
  ]);

  const synthese = {
    dossiersCrees,
    changementsStatut,
    documentsDeposes,
    messagesClient,
    messagesInternes,
    messagesGroupe,
    nouveauxClients,
    rdvTenus,
    rdvAVenir,
  };

  // ---- Par collaborateur (même logique que getActivityReports) ----
  const membres: DailyActivityReport["membres"] = [];
  try {
    const { data: roleRows } = await admin.from("user_roles").select("user_id, role");
    const rolesByUser = new Map<string, string[]>();
    for (const r of (roleRows ?? []) as any[]) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    }
    const memberIds = [...rolesByUser.entries()]
      .filter(([, rs]) => rs.some((r) => r !== "client"))
      .map(([id]) => id);

    if (memberIds.length > 0) {
      const [{ data: profiles }, { data: tasks }] = await Promise.all([
        admin.from("profiles").select("id, prenom, nom").in("id", memberIds),
        admin
          .from("agency_tasks")
          .select("id, title, status, due_date, completed_at, assigned_to, client_id, dossier_id")
          .is("archived_at", null)
          .limit(3000),
      ]);
      const taskList = (tasks ?? []) as any[];
      const { data: extra } = taskList.length
        ? await admin
            .from("agency_task_assignees")
            .select("task_id, user_id")
            .in("task_id", taskList.map((t) => t.id))
        : ({ data: [] } as any);

      const dossierIds = [...new Set(taskList.map((t) => t.dossier_id).filter(Boolean))];
      const clientIds = [...new Set(taskList.map((t) => t.client_id).filter(Boolean))];
      const [{ data: dossiers }, { data: clients }] = await Promise.all([
        dossierIds.length
          ? admin.from("dossiers").select("id, titre, organisme_nom").in("id", dossierIds)
          : Promise.resolve({ data: [] } as any),
        clientIds.length
          ? admin.from("profiles").select("id, prenom, nom, entreprise").in("id", clientIds)
          : Promise.resolve({ data: [] } as any),
      ]);
      const dMap = new Map(((dossiers ?? []) as any[]).map((d) => [d.id, d]));
      const cMap = new Map(((clients ?? []) as any[]).map((c) => [c.id, c]));
      const contextOf = (t: any) => {
        const d = t.dossier_id ? dMap.get(t.dossier_id) : null;
        if (d) return d.titre || d.organisme_nom;
        const c = t.client_id ? cMap.get(t.client_id) : null;
        return c ? c.entreprise || `${c.prenom ?? ""} ${c.nom ?? ""}`.trim() : null;
      };

      const byUser = new Map<string, any[]>();
      const push = (uid: string | null, t: any) => {
        if (!uid || !memberIds.includes(uid)) return;
        const arr = byUser.get(uid) ?? [];
        if (!arr.some((x) => x.id === t.id)) arr.push(t);
        byUser.set(uid, arr);
      };
      const taskById = new Map(taskList.map((t) => [t.id, t]));
      for (const t of taskList) push(t.assigned_to, t);
      for (const a of ((extra ?? []) as any[])) {
        const t = taskById.get(a.task_id);
        if (t) push(a.user_id, t);
      }

      const nowIso = now.toISOString();
      for (const p of ((profiles ?? []) as any[])) {
        const list = byUser.get(p.id) ?? [];
        const done = list.filter(
          (t) => t.status === "terminee" && t.completed_at && t.completed_at >= fromIso && t.completed_at <= toIso,
        );
        const open = list.filter((t) => t.status !== "terminee");
        const inProgress = open.filter((t) =>
          ["en_cours", "en_attente", "bloquee"].includes(t.status),
        );
        const overdue = open.filter((t) => t.due_date && t.due_date < nowIso);
        if (done.length === 0 && inProgress.length === 0 && overdue.length === 0) continue;
        const total = done.length + open.length;
        membres.push({
          nom: `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || "—",
          done: done.length,
          inProgress: inProgress.length,
          overdue: overdue.length,
          completionRate: total > 0 ? Math.round((done.length / total) * 100) : 0,
          contexts: [...new Set([...done, ...inProgress].map(contextOf).filter(Boolean) as string[])].slice(0, 6),
          doneTitles: done.slice(0, 8).map((t) => t.title as string),
        });
      }
      membres.sort((a, b) => b.done - a.done || a.nom.localeCompare(b.nom));
    }
  } catch (e) {
    console.error("[rapport-activite] membres failed", e);
  }

  // ---- Points d'attention (anomalies existantes + docs en attente) ----
  let attention: DailyActivityReport["attention"] = [];
  try {
    const anomalies = await computeAnomalies(admin);
    const keep = new Set([
      "tasks_overdue_7d",
      "dossiers_without_task",
      "dossiers_incomplete",
      "overloaded_members",
    ]);
    attention = anomalies
      .filter((a) => keep.has(a.kind))
      .map((a) => ({ label: a.label, count: a.count, gravite: a.gravite }));

    const docsPending = await count("documents", (q: any) =>
      q
        .eq("from_agence", true)
        .is("storage_path", null)
        .lt("created_at", new Date(now.getTime() - 72 * 3600_000).toISOString()),
    );
    if (docsPending > 0)
      attention.push({
        label: "Documents demandés en attente depuis plus de 72 h",
        count: docsPending,
        gravite: "majeur",
      });
  } catch (e) {
    console.error("[rapport-activite] anomalies failed", e);
  }

  // ---- Demain ----
  const tomorrowKey = parisDateKey(new Date(now.getTime() + 86400_000));
  const tFrom = parisInstant(tomorrowKey, 0).toISOString();
  const tTo = parisInstant(tomorrowKey, 23).toISOString();
  const demain: DailyActivityReport["demain"] = { echeances: [], rdv: [] };
  try {
    const [{ data: due }, { data: rdvs }] = await Promise.all([
      admin
        .from("agency_tasks")
        .select("title, due_date")
        .is("archived_at", null)
        .neq("status", "terminee")
        .gte("due_date", tFrom)
        .lte("due_date", tTo)
        .limit(20),
      admin
        .from("rendez_vous")
        .select("starts_at, client_id, notes")
        .gte("starts_at", tFrom)
        .lte("starts_at", tTo)
        .limit(20),
    ]);
    demain.echeances = ((due ?? []) as any[]).map((t) => t.title);
    demain.rdv = ((rdvs ?? []) as any[]).map(
      (r) =>
        `${new Date(r.starts_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })} — ${r.notes ?? "Rendez-vous"}`,
    );
  } catch (e) {
    console.error("[rapport-activite] demain failed", e);
  }

  return { periode, synthese, membres, attention, demain };
}

/** Envoi du rapport à tous les destinataires + journalisation supervision_emails. */
export async function sendDailyActivityReport(
  admin: any,
): Promise<{ sent: number; failed: number; recipients: string[] }> {
  const [{ recipients }, report] = await Promise.all([
    resolveReportRecipients(admin),
    buildDailyActivityReport(admin),
  ]);
  const dayKey = parisDateKey();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    let ok = false;
    let errorText: string | null = null;
    try {
      const res = await sendAppEmail({
        templateName: "rapport-activite",
        recipientEmail: recipient,
        idempotencyKey: `rapport-activite-${dayKey}-${recipient}`,
        templateData: { ...report, appUrl: APP_URL },
      });
      ok = res.success;
      if (!ok) errorText = `${(res as any).reason}${(res as any).error ? ` ${(res as any).error}` : ""}`.slice(0, 500);
    } catch (e) {
      errorText = String(e).slice(0, 500);
    }
    ok ? sent++ : failed++;
    try {
      await admin.from("supervision_emails").insert({
        type: "rapport_activite",
        recipient,
        status: ok ? "sent" : "failed",
        error: errorText,
      });
    } catch (e) {
      console.error("[rapport-activite] log failed", e);
    }
  }

  return { sent, failed, recipients };
}

/* ------------------------------------------------------------------ */
/* COMPTE RENDU QUOTIDIEN DÉTAILLÉ (personne par personne)             */
/* ------------------------------------------------------------------ */

import { ROLE_LABELS_FR } from "@/lib/role-labels";
import { sendSupervisionEmail } from "@/lib/supervision.server";
import { sendAppEmail } from "@/lib/email/send.server";

export interface DigestPerson {
  nom: string;
  roles: string[];
  poles: string[];
  presence: {
    dureeLabel: string;
    seconds: number;
    premiere: string | null;
    derniere: string | null;
    /** Plage lisible, datée si la période couvre plusieurs jours. */
    plage: string | null;

    sessions: number;
    lieux: string[];
    appareils: string[];
  };
  taches: {
    done: { titre: string; contexte: string | null; priorite: string; heure: string | null; note: string | null }[];
    inProgress: { titre: string; contexte: string | null; priorite: string; echeance: string | null; depuis: number }[];
    upcoming: { titre: string; contexte: string | null; echeance: string | null }[];
    overdue: { titre: string; echeance: string | null }[];
    blocked: { titre: string; contexte: string | null }[];
    completionRate: number;
    /** Vue unifiée pour le PDF : toutes les tâches de la personne, triées par état. */
    all: {
      etat: "Terminée" | "En cours" | "En retard" | "Bloquée" | "À venir";
      titre: string;
      contexte: string | null;
      quand: string | null;
      commentaires: string | null;
    }[];
  };

  actions: { label: string; count: number; items: string[] }[];
  contexts: string[];
  attention: string[];
  hasActivity: boolean;
}

/** Une ligne de tâche telle qu'affichée dans le PDF. */
export interface DigestTaskRow {
  etat: "Terminée" | "En cours" | "En retard" | "Bloquée" | "À venir";
  titre: string;
  contexte: string | null;
  responsable: string | null;
  quand: string | null;
  commentaires: string | null;
  /** Tous les échanges internes, du plus ancien au plus récent, texte intégral. */
  echanges: string[];
}



export interface DigestPoleSection {
  pole: string;
  ouvertes: number;
  termineesJour: number;
  enRetard: number;
  collaborateurs: number;
  taches: DigestTaskRow[];
}

export interface DigestMessagerieCanal {
  /** Nom lisible du fil : « Client — ALPHA FORMATION », « Interne — Pôle Qualiopi »… */
  canal: string;
  type: "Client" | "Interne" | "Groupe";
  /** Personnes présentes dans le fil, en clair. */
  participants: string | null;
  /** « 14:32 — Marie Dupont → ALPHA FORMATION (pièce jointe : contrat.pdf) » */
  lignes: string[];
  total: number;
}

/** Une pièce jointe échangée dans la journée, affichée dans le PDF. */
export interface DigestPieceJointe {
  heure: string;
  canal: string;
  auteur: string;
  nom: string;
  /** Image encodée en base64 (data URL) pour l'aperçu direct dans le PDF. */
  dataUrl: string | null;
  format: "JPEG" | "PNG" | null;
  /** Lien signé (30 jours) pour ouvrir le fichier depuis le PDF (PDF, Word, image…). */
  url?: string | null;
}


export interface DigestJournee {
  poles: { pole: string; poleId: string | null; personnes: { nom: string; evenements: { heure: string; texte: string }[] }[] }[];
  echanges: { titre: string; pole: string; poleId: string | null; lignes: string[] }[];
  /** Messagerie du jour, fil par fil, avec l'expéditeur et le destinataire. */
  messagerie: DigestMessagerieCanal[];
  /** Pièces jointes du jour (aperçu direct pour les images). */
  piecesJointes: DigestPieceJointe[];

  retards: { total: number; plusAnciennes: string[] };
  presence: { nom: string; duree: string; plage: string | null }[];
  absents: string[];
  chiffres: {
    tachesTerminees: number;
    dossiersCrees: number;
    documentsDeposes: number;
    messages: number;
    personnesActives: number;
  };
  calme: boolean;
}

export interface DigestPriority {
  etat: "En retard" | "Bloquée";
  titre: string;
  pole: string;
  responsable: string | null;
  contexte: string | null;
  joursRetard: number | null;
}

export interface DailyDigest {
  dateFr: string;
  periode: string;
  synthese: {
    connectes: number;
    equipe: number;
    tempsCumule: string;
    tachesTerminees: number;
    tachesEnCours: number;
    tachesEnRetard: number;
    dossiersCrees: number;
    changementsStatut: number;
    documentsDeposes: number;
    messages: number;
    nouveauxClients: number;
  };
  classement: { nom: string; done: number }[];
  personnes: DigestPerson[];
  /** Découpage par pôle — structure principale du PDF. */
  poleSections: DigestPoleSection[];
  /** Tâches en retard ou bloquées, à traiter en priorité. */
  priorites: DigestPriority[];
  /** Activité réelle de la journée, par pôle puis par personne. */
  journee: DigestJournee;
}

function fmtDuree(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

/** Union d'intervalles [début, fin] en ms, puis somme des durées fusionnées. */
function mergedDurationMs(intervals: { start: number; end: number }[]): number {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart: number | null = null;
  let curEnd = 0;
  for (const i of sorted) {
    if (curStart === null) {
      curStart = i.start;
      curEnd = i.end;
      continue;
    }
    if (i.start <= curEnd) curEnd = Math.max(curEnd, i.end);
    else {
      total += curEnd - curStart;
      curStart = i.start;
      curEnd = i.end;
    }
  }
  if (curStart !== null) total += curEnd - curStart;
  return total;
}


function heureParis(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function deviceLabel(ua: string | null | undefined): string | null {
  if (!ua) return null;
  if (/iPhone|iPad/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "Autre";
}

const ACTION_LABELS: { match: (a: string) => boolean; label: string }[] = [
  { match: (a) => a === "dossier.created", label: "Dossiers créés" },
  { match: (a) => a === "dossier.updated", label: "Dossiers modifiés" },
  { match: (a) => a === "dossier.status_changed", label: "Changements de statut de dossier" },
  { match: (a) => a === "document.uploaded", label: "Documents déposés" },
  { match: (a) => a === "document.downloaded", label: "Documents téléchargés" },
  { match: (a) => a === "message.sent", label: "Messages clients envoyés" },
  { match: (a) => a === "internal_message.sent", label: "Messages internes envoyés" },
  { match: (a) => a === "group_message.sent", label: "Messages de groupe envoyés" },
  { match: (a) => a.startsWith("agency_task."), label: "Tâches (création / statut / clôture)" },
  { match: (a) => a.startsWith("dossier.assignment"), label: "Assignations de dossier" },
  { match: (a) => a.startsWith("rdv") || a.startsWith("rendez_vous"), label: "Rendez-vous" },
];

function actionGroup(action: string): string | null {
  return ACTION_LABELS.find((x) => x.match(action))?.label ?? null;
}

/**
 * Agrégation complète du compte rendu quotidien, personne par personne.
 * `at` : recalcul d'une journée passée (borne de fin = 23h59 heure de Paris de ce jour).
 */
export async function buildDailyDigest(admin: any, at?: Date): Promise<DailyDigest> {
  const real = new Date();
  const now = at
    ? new Date(Math.min(parisInstant(parisDateKey(at), 0).getTime() + 86400_000 - 1000, real.getTime()))
    : real;
  const dayKey = parisDateKey(now);

  // Fenêtre : toujours la journée en cours (Europe/Paris), de 00h00 à l'heure d'envoi.
  const from = parisInstant(dayKey, 0);
  const fromIso = from.toISOString();
  const toIso = now.toISOString();
  const fromMs = from.getTime();
  const toMs = now.getTime();
  const dateFr = now.toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const periode = `${dateFr}, de 00h00 à ${heureParis(toIso)}`;

  // --- Équipe ---
  const { data: roleRows } = await admin.from("user_roles").select("user_id, role");
  const rolesByUser = new Map<string, string[]>();
  for (const r of (roleRows ?? []) as any[]) {
    const arr = rolesByUser.get(r.user_id) ?? [];
    arr.push(r.role);
    rolesByUser.set(r.user_id, arr);
  }
  const memberIds = [...rolesByUser.entries()]
    .filter(([, rs]) => rs.some((r) => r !== "client"))
    .map(([id]) => id);

  if (memberIds.length === 0) {
    return {
      dateFr,
      periode,
      synthese: {
        connectes: 0, equipe: 0, tempsCumule: "0 min", tachesTerminees: 0, tachesEnCours: 0,
        tachesEnRetard: 0, dossiersCrees: 0, changementsStatut: 0, documentsDeposes: 0,
        messages: 0, nouveauxClients: 0,
      },
      classement: [],
      personnes: [],
      poleSections: [],
      priorites: [],
      journee: {
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
      },


    };
  }

  const [
    { data: profiles },
    { data: poleMembers },
    { data: sessions },
    { data: tasks },
    { data: logs },
  ] = await Promise.all([
    admin.from("profiles").select("id, prenom, nom, email, archived_at").in("id", memberIds),
    admin.from("pole_members").select("user_id, pole_id").in("user_id", memberIds),
    admin
      .from("user_sessions")
      .select("user_id, started_at, ended_at, last_seen_at, duration_seconds, city, user_agent")
      .lte("started_at", toIso)
      .gte("last_seen_at", fromIso)
      .limit(5000),
    admin
      .from("agency_tasks")
      .select(
        "id, title, priority, status, due_date, completed_at, created_at, client_id, dossier_id, pole_id, internal_comment, assigned_to, updated_by, updated_at",
      )
      .is("archived_at", null)
      .limit(3000),

    admin
      .from("audit_logs")
      .select("id, user_id, action, entity_type, entity_id, metadata, created_at")
      .in("user_id", memberIds)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: true })
      .limit(5000),
  ]);

  const { data: poles } = await admin.from("poles").select("id, nom");
  const poleNames = new Map(((poles ?? []) as any[]).map((p) => [p.id, p.nom as string]));
  const polesByUser = new Map<string, string[]>();
  for (const pm of (poleMembers ?? []) as any[]) {
    const arr = polesByUser.get(pm.user_id) ?? [];
    const n = poleNames.get(pm.pole_id);
    if (n) arr.push(n);
    polesByUser.set(pm.user_id, arr);
  }

  // --- Tâches par utilisateur (assignation simple + multiple) ---
  const taskList = (tasks ?? []) as any[];
  const { data: extraAssignees } = taskList.length
    ? await admin
        .from("agency_task_assignees")
        .select("task_id, user_id")
        .in("task_id", taskList.map((t) => t.id))
    : ({ data: [] } as any);

  // --- Noms des personnes citées (responsables, auteurs de notes) ---
  const peopleIds = new Set<string>(memberIds);
  for (const t of taskList) {
    if (t.assigned_to) peopleIds.add(t.assigned_to);
    if (t.updated_by) peopleIds.add(t.updated_by);
  }
  for (const a of ((extraAssignees ?? []) as any[])) if (a.user_id) peopleIds.add(a.user_id);
  const { data: peopleProfiles } = peopleIds.size
    ? await admin.from("profiles").select("id, prenom, nom, email").in("id", [...peopleIds])
    : ({ data: [] } as any);
  const nameById = new Map<string, string>(
    ((peopleProfiles ?? []) as any[]).map((p) => [
      p.id,
      `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || "—",
    ]),
  );

  /** « JJ/MM à HH:MM » en heure de Paris. */
  const dateHeureParis = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    const jour = d.toLocaleDateString("fr-FR", {
      timeZone: "Europe/Paris",
      day: "2-digit",
      month: "2-digit",
    });
    return `${jour} à ${heureParis(iso)}`;
  };

  /** Horodatage court « JJ/MM HH:MM » utilisé dans les échanges internes du PDF. */
  const stampParis = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const jour = new Date(iso).toLocaleDateString("fr-FR", {
      timeZone: "Europe/Paris",
      day: "2-digit",
      month: "2-digit",
    });
    return `${jour} ${heureParis(iso)}`;
  };


  // --- Commentaires de tâches (30 derniers jours) : auteur + date obligatoires ---
  const commentsByTask = new Map<string, { at: number; texte: string }[]>();
  /** Commentaires postés PENDANT la journée : bruts, pour la section « échanges du jour ». */
  const commentsTodayRaw: { taskId: string; userId: string | null; at: number; texte: string }[] = [];
  try {
    if (taskList.length) {
      const depuis = new Date(now.getTime() - 30 * 86400_000).toISOString();
      const { data: taskComments } = await admin
        .from("agency_task_comments")
        .select("task_id, user_id, content, created_at")
        .in("task_id", taskList.map((t) => t.id))
        .gte("created_at", depuis)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false })
        .limit(3000);
      const rows = (taskComments ?? []) as any[];
      const authorIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))].filter(
        (id) => !nameById.has(id),
      );
      if (authorIds.length) {
        const { data: authors } = await admin
          .from("profiles")
          .select("id, prenom, nom, email")
          .in("id", authorIds);
        for (const a of ((authors ?? []) as any[]))
          nameById.set(a.id, `${a.prenom ?? ""} ${a.nom ?? ""}`.trim() || a.email || "—");
      }
      for (const r of rows) {
        const texte = String(r.content ?? "").trim();
        if (!texte) continue;
        const auteur = r.user_id ? nameById.get(r.user_id) : null;
        const arr = commentsByTask.get(r.task_id) ?? [];
        arr.push({
          at: new Date(r.created_at).getTime(),
          texte: `${stampParis(r.created_at)}  ${auteur ?? "(auteur non tracé)"} : ${texte}`,
        });
        commentsByTask.set(r.task_id, arr);
        const atMs = new Date(r.created_at).getTime();
        if (atMs >= fromMs && atMs <= toMs) {
          commentsTodayRaw.push({
            taskId: r.task_id,
            userId: r.user_id ?? null,
            at: atMs,
            texte: `${heureParis(r.created_at)}  ${auteur ?? "(auteur non tracé)"} : ${texte.replace(/\s*\n\s*/g, " ")}`,
          });
        }
      }
    }
  } catch (e) {
    console.error("[compte-rendu] commentaires de tâches indisponibles", e);
  }

  /**
   * Tous les échanges internes d'une tâche : note interne + commentaires,
   * du plus ancien au plus récent, texte intégral, aucune troncature.
   */
  const taskCommentList = (t: any): string[] => {
    const parts: { at: number; texte: string }[] = (commentsByTask.get(t.id) ?? []).filter(
      (c) => c.at >= fromMs && c.at <= toMs,
    );
    const internal = String(t.internal_comment ?? "").trim();
    const internalAt = t.updated_at ? new Date(t.updated_at).getTime() : null;
    // Une note interne n'est retenue que si elle a été modifiée PENDANT la journée couverte.
    if (internal && internalAt !== null && internalAt >= fromMs && internalAt <= toMs) {
      const auteur = t.updated_by ? nameById.get(t.updated_by) : null;
      const quand = t.updated_at ? stampParis(t.updated_at) : null;
      parts.push({
        at: t.updated_at ? new Date(t.updated_at).getTime() : 0,
        texte:
          auteur && quand
            ? `${quand}  ${auteur} (note interne) : ${internal}`
            : `${quand ?? ""} (note interne) : ${internal}`.trim(),
      });
    }
    return parts.sort((a, b) => a.at - b.at).map((c) => c.texte.replace(/\s*\n\s*/g, " "));
  };

  const taskComments = (t: any): string | null => {
    const list = taskCommentList(t);
    return list.length ? list.join("\n") : null;
  };





  const dossierIds = new Set<string>();
  const clientIds = new Set<string>();
  for (const t of taskList) {
    if (t.dossier_id) dossierIds.add(t.dossier_id);
    if (t.client_id) clientIds.add(t.client_id);
  }
  for (const l of (logs ?? []) as any[]) {
    if (l.entity_type === "dossier" && l.entity_id) dossierIds.add(l.entity_id);
    const m: any = l.metadata || {};
    if (m.dossier_id) dossierIds.add(m.dossier_id);
    if (m.client_id) clientIds.add(m.client_id);
  }
  const docIds = [
    ...new Set(
      ((logs ?? []) as any[])
        .filter((l) => l.entity_type === "document" && l.entity_id)
        .map((l) => l.entity_id),
    ),
  ];

  const [{ data: dossiers }, { data: clients }, { data: docs }] = await Promise.all([
    dossierIds.size
      ? admin.from("dossiers").select("id, titre, organisme_nom").in("id", [...dossierIds])
      : Promise.resolve({ data: [] } as any),
    clientIds.size
      ? admin.from("profiles").select("id, prenom, nom, entreprise").in("id", [...clientIds])
      : Promise.resolve({ data: [] } as any),
    docIds.length
      ? admin.from("documents").select("id, nom").in("id", docIds)
      : Promise.resolve({ data: [] } as any),
  ]);
  const dMap = new Map(((dossiers ?? []) as any[]).map((d) => [d.id, d]));
  const cMap = new Map(((clients ?? []) as any[]).map((c) => [c.id, c]));
  const docMap = new Map(((docs ?? []) as any[]).map((d) => [d.id, d]));

  const clientLabel = (id: string | null) => {
    const c = id ? cMap.get(id) : null;
    return c ? c.entreprise || `${c.prenom ?? ""} ${c.nom ?? ""}`.trim() : null;
  };
  const dossierLabel = (id: string | null) => {
    const d = id ? dMap.get(id) : null;
    return d ? d.titre || d.organisme_nom : null;
  };
  const taskContext = (t: any) => dossierLabel(t.dossier_id) ?? clientLabel(t.client_id);

  const tasksByUser = new Map<string, any[]>();
  const pushTask = (uid: string | null, t: any) => {
    if (!uid || !memberIds.includes(uid)) return;
    const arr = tasksByUser.get(uid) ?? [];
    if (!arr.some((x) => x.id === t.id)) arr.push(t);
    tasksByUser.set(uid, arr);
  };
  const taskById = new Map(taskList.map((t) => [t.id, t]));
  for (const t of taskList) pushTask(t.assigned_to, t);
  for (const a of ((extraAssignees ?? []) as any[])) {
    const t = taskById.get(a.task_id);
    if (t) pushTask(a.user_id, t);
  }

  // --- Sessions par utilisateur (clippées sur la fenêtre) ---
  const sessionsByUser = new Map<string, any[]>();
  for (const s of (sessions ?? []) as any[]) {
    const arr = sessionsByUser.get(s.user_id) ?? [];
    arr.push(s);
    sessionsByUser.set(s.user_id, arr);
  }

  const windowStart = from.getTime();
  const windowEnd = now.getTime();

  // --- Logs par utilisateur ---
  const logsByUser = new Map<string, any[]>();
  for (const l of (logs ?? []) as any[]) {
    const arr = logsByUser.get(l.user_id) ?? [];
    arr.push(l);
    logsByUser.set(l.user_id, arr);
  }

  const tomorrowKey = parisDateKey(new Date(now.getTime() + 86400_000));
  const tFrom = parisInstant(tomorrowKey, 0).toISOString();
  const tTo = parisInstant(tomorrowKey, 23).toISOString();
  const overdue7 = new Date(now.getTime() - 7 * 86400_000).toISOString();

  const personnes: DigestPerson[] = [];

  for (const p of (profiles ?? []) as any[]) {
    // Présence : union d'intervalles, sessions ouvertes plafonnées, total borné à la fenêtre
    const sess = sessionsByUser.get(p.id) ?? [];
    const OPEN_SESSION_CAP_MS = 4 * 3600_000; // session jamais fermée : 4 h maximum
    const intervals: { start: number; end: number }[] = [];
    const lieux = new Set<string>();
    const appareils = new Set<string>();
    let sessionCount = 0;
    for (const s of sess) {
      const start = new Date(s.started_at).getTime();
      const lastSeen = new Date(s.last_seen_at ?? s.started_at).getTime();
      let end: number;
      if (s.ended_at) {
        end = new Date(s.ended_at).getTime();
      } else if (s.duration_seconds) {
        end = start + Math.min(s.duration_seconds * 1000, OPEN_SESSION_CAP_MS);
      } else {
        // Session ouverte : on ne compte que jusqu'au dernier signe de vie, plafonné.
        end = Math.min(lastSeen, start + OPEN_SESSION_CAP_MS);
      }
      if (end - start > OPEN_SESSION_CAP_MS && !s.ended_at) end = start + OPEN_SESSION_CAP_MS;
      const clippedStart = Math.max(start, windowStart);
      const clippedEnd = Math.min(end, windowEnd);
      if (clippedEnd <= clippedStart) continue;
      sessionCount++;
      intervals.push({ start: clippedStart, end: clippedEnd });
      if (s.city) lieux.add(s.city);
      const dev = deviceLabel(s.user_agent);
      if (dev) appareils.add(dev);
    }
    const windowSeconds = Math.max(0, (windowEnd - windowStart) / 1000);
    const seconds = Math.min(mergedDurationMs(intervals) / 1000, windowSeconds);
    const premiere = intervals.length ? Math.min(...intervals.map((i) => i.start)) : null;
    const derniere = intervals.length ? Math.max(...intervals.map((i) => i.end)) : null;


    // Tâches
    const list = tasksByUser.get(p.id) ?? [];
    const done = list.filter(
      (t) => t.status === "terminee" && t.completed_at && t.completed_at >= fromIso && t.completed_at <= toIso,
    );
    const open = list.filter((t) => t.status !== "terminee");
    const inProgress = open.filter((t) => ["en_cours", "en_attente", "bloquee"].includes(t.status));
    const upcoming = open.filter((t) => t.status === "a_faire");
    const overdue = open.filter((t) => t.due_date && t.due_date < toIso);
    const blocked = open.filter((t) => t.status === "bloquee");
    const total = done.length + open.length;

    // Actions (audit_logs) : on ne détaille que les entrées dont l'objet est identifiable
    const myLogs = logsByUser.get(p.id) ?? [];
    const grouped = new Map<string, { total: number; items: string[] }>();
    for (const l of myLogs) {
      const g = actionGroup(l.action);
      if (!g) continue;
      const h = heureParis(l.created_at);
      const meta: any = l.metadata || {};
      let libelle: string | null = null;
      if (l.entity_type === "dossier") libelle = dossierLabel(l.entity_id);
      else if (l.entity_type === "document") libelle = docMap.get(l.entity_id)?.nom ?? null;
      if (!libelle) libelle = clientLabel(meta.client_id) ?? dossierLabel(meta.dossier_id);
      if (!libelle) libelle = meta.titre ?? meta.title ?? meta.nom ?? null;
      let suffix = "";
      if (l.action === "dossier.status_changed" && (meta.from || meta.old || meta.to || meta.new)) {
        suffix = ` (${meta.from ?? meta.old ?? "?"} vers ${meta.to ?? meta.new ?? "?"})`;
      }
      const entry = grouped.get(g) ?? { total: 0, items: [] };
      entry.total++;
      if (libelle) entry.items.push(`${h} — ${libelle}${suffix}`);
      grouped.set(g, entry);
    }
    const actions = [...grouped.entries()].map(([label, e]) => ({
      label,
      count: e.total,
      items: e.items.slice(0, 10),
    }));


    // Clients / dossiers touchés
    const contexts = new Set<string>();
    for (const t of [...done, ...inProgress]) {
      const c = taskContext(t);
      if (c) contexts.add(c);
    }
    for (const l of myLogs) {
      const meta: any = l.metadata || {};
      const c =
        (l.entity_type === "dossier" ? dossierLabel(l.entity_id) : null) ??
        dossierLabel(meta.dossier_id) ??
        clientLabel(meta.client_id);
      if (c) contexts.add(c);
    }

    // Points d'attention
    const attention: string[] = [];
    const veryLate = overdue.filter((t) => t.due_date && t.due_date < overdue7);
    if (veryLate.length)
      attention.push(`${veryLate.length} tâche(s) en retard de plus de 7 jours : ${veryLate.slice(0, 3).map((t) => t.title).join(", ")}`);
    if (blocked.length)
      attention.push(`${blocked.length} tâche(s) bloquée(s) : ${blocked.slice(0, 3).map((t) => t.title).join(", ")}`);
    const demain = open.filter((t) => t.due_date && t.due_date >= tFrom && t.due_date <= tTo);
    if (demain.length)
      attention.push(`${demain.length} échéance(s) demain : ${demain.slice(0, 3).map((t) => t.title).join(", ")}`);

    const hasActivity =
      seconds > 0 || done.length > 0 || myLogs.length > 0 || inProgress.length > 0;

    personnes.push({
      nom: `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || "—",
      roles: (rolesByUser.get(p.id) ?? []).map((r) => ROLE_LABELS_FR[r] ?? r),
      poles: polesByUser.get(p.id) ?? [],
      presence: {
        dureeLabel: fmtDuree(seconds),
        seconds: Math.round(seconds),
        premiere: premiere ? heureParis(new Date(premiere).toISOString()) : null,
        derniere: derniere ? heureParis(new Date(derniere).toISOString()) : null,
        plage:
          premiere && derniere
            ? `${heureParis(new Date(premiere).toISOString())} - ${heureParis(new Date(derniere).toISOString())}`
            : null,

        sessions: sessionCount,
        lieux: [...lieux].slice(0, 3),
        appareils: [...appareils].slice(0, 3),
      },
      taches: {
        done: done.slice(0, 20).map((t) => ({
          titre: t.title,
          contexte: taskContext(t),
          priorite: t.priority,
          heure: heureParis(t.completed_at),
          note: t.internal_comment ?? null,
        })),
        inProgress: inProgress.slice(0, 20).map((t) => ({
          titre: t.title,
          contexte: taskContext(t),
          priorite: t.priority,
          echeance: t.due_date ? new Date(t.due_date).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : null,
          depuis: Math.max(0, Math.round((now.getTime() - new Date(t.created_at).getTime()) / 86400_000)),
        })),
        upcoming: upcoming.slice(0, 10).map((t) => ({
          titre: t.title,
          contexte: taskContext(t),
          echeance: t.due_date ? new Date(t.due_date).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : null,
        })),
        overdue: overdue.slice(0, 10).map((t) => ({
          titre: t.title,
          echeance: t.due_date ? new Date(t.due_date).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : null,
        })),
        blocked: blocked.slice(0, 10).map((t) => ({ titre: t.title, contexte: taskContext(t) })),
        completionRate: total > 0 ? Math.round((done.length / total) * 100) : 0,
        all: (() => {
          const ORDER = { "Terminée": 0, "En cours": 1, "En retard": 2, "Bloquée": 3, "À venir": 4 } as const;
          const etatOf = (t: any): keyof typeof ORDER => {
            if (t.status === "terminee") return "Terminée";
            if (t.status === "bloquee") return "Bloquée";
            if (t.due_date && t.due_date < toIso) return "En retard";
            if (t.status === "en_cours" || t.status === "en_attente") return "En cours";
            return "À venir";
          };
          const dateFrOf = (v: string | null) =>
            v ? new Date(v).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : null;
          return [...done, ...open]
            .map((t) => {
              const etat = etatOf(t);
              return {
                etat,
                titre: t.title as string,
                contexte: taskContext(t),
                quand: etat === "Terminée" ? heureParis(t.completed_at) : dateFrOf(t.due_date),
                commentaires: taskComments(t),
              };
            })
            .sort((a, b) => ORDER[a.etat] - ORDER[b.etat] || a.titre.localeCompare(b.titre))
            .slice(0, 40);
        })(),
      },
      actions,
      contexts: [...contexts].slice(0, 12),
      attention,
      hasActivity,
    });
  }

  personnes.sort(
    (a, b) => b.taches.done.length - a.taches.done.length || a.nom.localeCompare(b.nom),
  );

  // --- Synthèse équipe ---
  const countRows = async (table: string, build: (q: any) => any) => {
    try {
      const { count: c } = await build(admin.from(table).select("id", { count: "exact", head: true }));
      return c ?? 0;
    } catch {
      return 0;
    }
  };
  const [dossiersCrees, documentsDeposes, msgC, msgI, msgG, nouveauxClients, changementsStatut] =
    await Promise.all([
      countRows("dossiers", (q: any) => q.gte("created_at", fromIso).lte("created_at", toIso)),
      countRows("documents", (q: any) =>
        q.gte("created_at", fromIso).lte("created_at", toIso).not("storage_path", "is", null),
      ),
      countRows("messages", (q: any) => q.gte("created_at", fromIso).lte("created_at", toIso)),
      countRows("internal_messages", (q: any) => q.gte("created_at", fromIso).lte("created_at", toIso)),
      countRows("group_messages", (q: any) => q.gte("created_at", fromIso).lte("created_at", toIso)),
      countRows("profiles", (q: any) => q.gte("created_at", fromIso).lte("created_at", toIso)),
      countRows("audit_logs", (q: any) =>
        q.gte("created_at", fromIso).lte("created_at", toIso).eq("action", "dossier.status_changed"),
      ),
    ]);

  const connectes = personnes.filter((p) => p.presence.seconds > 0).length;
  const windowSecondsTotal = Math.max(0, (windowEnd - windowStart) / 1000);
  const tempsCumuleSec = Math.min(
    personnes.reduce((n, p) => n + p.presence.seconds, 0),
    connectes * windowSecondsTotal,
  );

  /* ---- Découpage par pôle (structure principale du PDF) ---- */
  const SANS_POLE = "Sans pôle";
  const etatOfTask = (t: any): DigestTaskRow["etat"] => {
    if (t.status === "terminee") return "Terminée";
    if (t.status === "bloquee") return "Bloquée";
    if (t.due_date && t.due_date < toIso) return "En retard";
    if (t.status === "en_cours" || t.status === "en_attente") return "En cours";
    return "À venir";
  };
  const ETAT_ORDER: Record<DigestTaskRow["etat"], number> = {
    "Terminée": 0, "En cours": 1, "En retard": 2, "Bloquée": 3, "À venir": 4,
  };
  const dateFrOf = (v: string | null) =>
    v ? new Date(v).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : null;

  const assigneesByTask = new Map<string, string[]>();
  for (const a of ((extraAssignees ?? []) as any[])) {
    const arr = assigneesByTask.get(a.task_id) ?? [];
    if (a.user_id) arr.push(a.user_id);
    assigneesByTask.set(a.task_id, arr);
  }
  const responsableOf = (t: any): string | null => {
    const ids = [t.assigned_to, ...(assigneesByTask.get(t.id) ?? [])].filter(Boolean) as string[];
    const names = [...new Set(ids.map((id) => nameById.get(id)).filter(Boolean) as string[])];
    return names.length ? names.join(", ") : null;
  };

  // Tâches retenues : terminées sur la période + toutes les tâches ouvertes.
  const retenues = taskList.filter(
    (t) =>
      t.status !== "terminee" ||
      (t.completed_at && t.completed_at >= fromIso && t.completed_at <= toIso),
  );

  const bucket = new Map<string, any[]>();
  for (const t of retenues) {
    const nom = (t.pole_id ? poleNames.get(t.pole_id) : null) ?? SANS_POLE;
    const arr = bucket.get(nom) ?? [];
    arr.push(t);
    bucket.set(nom, arr);
  }

  const poleSections: DigestPoleSection[] = [...bucket.entries()]
    .map(([pole, list]) => {
      const collaborateurs = new Set<string>();
      for (const t of list) {
        if (t.assigned_to) collaborateurs.add(t.assigned_to);
        for (const u of assigneesByTask.get(t.id) ?? []) collaborateurs.add(u);
      }
      const taches: DigestTaskRow[] = list
        .map((t) => {
          const etat = etatOfTask(t);
          return {
            etat,
            titre: String(t.title ?? ""),
            contexte: taskContext(t),
            responsable: responsableOf(t),
            quand: etat === "Terminée" ? heureParis(t.completed_at) : dateFrOf(t.due_date),
            commentaires: taskComments(t),
            echanges: taskCommentList(t),

          };
        })
        .sort(
          (a, b) =>
            ETAT_ORDER[a.etat] - ETAT_ORDER[b.etat] || a.titre.localeCompare(b.titre),
        )
        .slice(0, 30);
      return {
        pole,
        ouvertes: list.filter((t) => t.status !== "terminee").length,
        termineesJour: list.filter((t) => t.status === "terminee").length,
        enRetard: taches.filter((t) => t.etat === "En retard").length,
        collaborateurs: collaborateurs.size,
        taches,
      };
    })
    .filter((s) => s.taches.length > 0)
    .sort((a, b) => {
      if (a.pole === SANS_POLE) return 1;
      if (b.pole === SANS_POLE) return -1;
      return b.enRetard - a.enRetard || a.pole.localeCompare(b.pole);
    });

  /* ---- À traiter en priorité : tâches en retard ou bloquées ---- */
  const priorites: DigestPriority[] = retenues
    .filter((t) => {
      const e = etatOfTask(t);
      return e === "En retard" || e === "Bloquée";
    })
    .map((t) => {
      const e = etatOfTask(t) as "En retard" | "Bloquée";
      return {
        etat: e,
        titre: String(t.title ?? ""),
        pole: (t.pole_id ? poleNames.get(t.pole_id) : null) ?? SANS_POLE,
        responsable: responsableOf(t),
        contexte: taskContext(t),
        joursRetard: t.due_date
          ? Math.max(
              0,
              Math.floor((now.getTime() - new Date(t.due_date).getTime()) / 86400_000),
            )
          : null,
      };
    })
    .sort((a, b) => (b.joursRetard ?? -1) - (a.joursRetard ?? -1))
    .slice(0, 18);

  /* ---- Journée : uniquement ce qui a bougé aujourd'hui ---- */
  const poleOfTask = (t: any): string =>
    (t?.pole_id ? poleNames.get(t.pole_id) : null) ?? SANS_POLE;
  const poleIdOfTask = (t: any): string | null => (t?.pole_id ?? null);
  const poleIdByName = new Map<string, string | null>();
  for (const [id, nom] of poleNames) poleIdByName.set(nom as string, id as string);
  poleIdByName.set(SANS_POLE, null);
  const poleOfUser = (uid: string): string => (polesByUser.get(uid) ?? [])[0] ?? SANS_POLE;
  const evByPolePerson = new Map<string, Map<string, { at: number; heure: string; texte: string }[]>>();
  const pushEvent = (pole: string, nom: string, at: number, heure: string | null, texte: string) => {
    const perPole = evByPolePerson.get(pole) ?? new Map();
    const arr = perPole.get(nom) ?? [];
    arr.push({ at, heure: heure ?? "—", texte });
    perPole.set(nom, arr);
    evByPolePerson.set(pole, perPole);
  };

  // Tâches terminées aujourd'hui
  for (const t of taskList) {
    if (t.status !== "terminee" || !t.completed_at) continue;
    if (t.completed_at < fromIso || t.completed_at > toIso) continue;
    const ids = [...new Set([t.assigned_to, ...(assigneesByTask.get(t.id) ?? [])].filter(Boolean))] as string[];
    const noms = ids.map((id) => nameById.get(id)).filter(Boolean) as string[];
    const ctx = taskContext(t);
    const texte = `Tâche terminée : ${t.title}${ctx && !String(t.title ?? "").includes(ctx) ? ` (${ctx})` : ""}`;
    for (const nom of noms.length ? noms : ["Non assigné"])
      pushEvent(poleOfTask(t), nom, new Date(t.completed_at).getTime(), heureParis(t.completed_at), texte);
  }

  // Commentaires postés aujourd'hui
  const echangesJour: { titre: string; pole: string; poleId: string | null; lignes: string[] }[] = [];
  const commentsByTaskToday = new Map<string, typeof commentsTodayRaw>();
  for (const c of commentsTodayRaw) {
    const arr = commentsByTaskToday.get(c.taskId) ?? [];
    arr.push(c);
    commentsByTaskToday.set(c.taskId, arr);
  }
  for (const [taskId, list] of commentsByTaskToday) {
    const t = taskById.get(taskId);
    const ctx = t ? taskContext(t) : null;
    const titre = `${t?.title ?? "Tâche"}${ctx && !String(t?.title ?? "").includes(ctx) ? ` — ${ctx}` : ""}`;
    const pole = poleOfTask(t);
    echangesJour.push({
      titre,
      pole,
      poleId: poleIdOfTask(t),
      lignes: [...list].sort((a, b) => a.at - b.at).map((c) => c.texte),
    });
    for (const c of list) {
      const nom = c.userId ? nameById.get(c.userId) : null;
      if (!nom) continue;
      pushEvent(pole, nom, c.at, heureParis(new Date(c.at).toISOString()), `Commentaire sur « ${t?.title ?? "tâche"} »`);
    }
  }

  // Actions tracées (dossiers, documents, messages, RDV, tâches)
  for (const [uid, myLogs] of logsByUser) {
    const nom = nameById.get(uid);
    if (!nom) continue;
    for (const l of myLogs) {
      // Les messages sont détaillés plus bas (expéditeur → destinataire réels).
      if (/message\.sent$/.test(String(l.action))) continue;
      const label = actionGroup(l.action);
      if (!label) continue;
      const meta: any = l.metadata || {};
      let libelle: string | null = null;
      if (l.entity_type === "dossier") libelle = dossierLabel(l.entity_id);
      else if (l.entity_type === "document") libelle = docMap.get(l.entity_id)?.nom ?? null;
      if (!libelle) libelle = clientLabel(meta.client_id) ?? dossierLabel(meta.dossier_id);
      if (!libelle) libelle = meta.titre ?? meta.title ?? meta.nom ?? null;
      let suffix = "";
      if (l.action === "dossier.status_changed" && (meta.from || meta.old || meta.to || meta.new))
        suffix = ` (${meta.from ?? meta.old ?? "?"} vers ${meta.to ?? meta.new ?? "?"})`;
      pushEvent(
        poleOfUser(uid),
        nom,
        new Date(l.created_at).getTime(),
        heureParis(l.created_at),
        `${label}${libelle ? ` : ${libelle}` : ""}${suffix}`,
      );
    }
  }

  /* ---- Messagerie du jour : qui a écrit, à qui, à quelle heure ---- */
  const messagerie: DigestMessagerieCanal[] = [];
  const piecesJointes: DigestPieceJointe[] = [];
  /** Pièces jointes repérées dans la journée, avant récupération du fichier. */
  const piecesBrutes: {
    at: number;
    heure: string;
    canal: string;
    auteur: string;
    nom: string;
    bucket: string;
    path: string | null;
    mime: string | null;
  }[] = [];
  try {
    const [{ data: msgCli }, { data: msgInt }, { data: msgGrp }] = await Promise.all([
      admin
        .from("messages")
        .select("id, client_id, sender_id, from_agence, created_at, content, attachment_name, attachment_path, attachment_mime, is_system, deleted_at")
        .gte("created_at", fromIso).lte("created_at", toIso)
        .order("created_at", { ascending: true }).limit(2000),
      admin
        .from("internal_messages")
        .select("id, conversation_id, sender_id, created_at, content, attachment_name, attachment_path, attachment_mime, is_system, deleted_at")
        .gte("created_at", fromIso).lte("created_at", toIso)
        .order("created_at", { ascending: true }).limit(2000),
      admin
        .from("group_messages")
        .select("id, conversation_id, sender_id, created_at, content, attachment_name, attachment_path, attachment_mime, is_system, deleted_at")
        .gte("created_at", fromIso).lte("created_at", toIso)
        .order("created_at", { ascending: true }).limit(2000),

    ]);
    const cliRows = ((msgCli ?? []) as any[]).filter((m) => !m.is_system);
    const intRows = ((msgInt ?? []) as any[]).filter((m) => !m.is_system);
    const grpRows = ((msgGrp ?? []) as any[]).filter((m) => !m.is_system);

    const intConvIds = [...new Set(intRows.map((m) => m.conversation_id).filter(Boolean))];
    const grpConvIds = [...new Set(grpRows.map((m) => m.conversation_id).filter(Boolean))];
    const [{ data: intConvs }, { data: grpConvs }, { data: intMembers }, { data: grpMembers }] =
      await Promise.all([
        intConvIds.length
          ? admin.from("internal_conversations").select("id, titre, type, is_group, client_id, pole_id").in("id", intConvIds)
          : Promise.resolve({ data: [] } as any),
        grpConvIds.length
          ? admin.from("conversations").select("id, titre").in("id", grpConvIds)
          : Promise.resolve({ data: [] } as any),
        intConvIds.length
          ? admin.from("internal_conversation_members").select("conversation_id, user_id").in("conversation_id", intConvIds)
          : Promise.resolve({ data: [] } as any),
        grpConvIds.length
          ? admin.from("conversation_members").select("conversation_id, user_id").in("conversation_id", grpConvIds)
          : Promise.resolve({ data: [] } as any),
      ]);

    // Noms manquants (clients, membres de fils) — complète nameById.
    const besoin = new Set<string>();
    const addBesoin = (id: any) => { if (id && !nameById.has(id)) besoin.add(id); };
    for (const m of cliRows) { addBesoin(m.sender_id); addBesoin(m.client_id); }
    for (const m of [...intRows, ...grpRows]) addBesoin(m.sender_id);
    for (const r of ((intMembers ?? []) as any[])) addBesoin(r.user_id);
    for (const r of ((grpMembers ?? []) as any[])) addBesoin(r.user_id);
    for (const c of ((intConvs ?? []) as any[])) addBesoin(c.client_id);
    if (besoin.size) {
      const { data: extra } = await admin
        .from("profiles").select("id, prenom, nom, email, entreprise").in("id", [...besoin]);
      for (const p of ((extra ?? []) as any[]))
        nameById.set(p.id, `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.entreprise || p.email || "—");
    }
    const nomDe = (id: any): string => (id ? nameById.get(id) ?? "Utilisateur inconnu" : "—");
    const membresDe = (rows: any[], convId: string, exclude?: string) =>
      [...new Set(rows.filter((r) => r.conversation_id === convId && r.user_id !== exclude).map((r) => nomDe(r.user_id)))];
    const piece = (m: any) => (m.attachment_name ? ` — pièce jointe : ${m.attachment_name}` : "");
    /** Mémorise une pièce jointe pour l'aperçu dans le PDF. */
    const collectPiece = (m: any, bucket: string, canal: string) => {
      if (!m.attachment_name || m.deleted_at) return;
      piecesBrutes.push({
        at: new Date(m.created_at).getTime(),
        heure: heureParis(m.created_at) ?? "",
        canal,
        auteur: nomDe(m.sender_id),
        nom: String(m.attachment_name),
        bucket,
        path: m.attachment_path ?? null,
        mime: m.attachment_mime ?? null,
      });
    };

    /** Contenu du message, sur une ligne, tronqué pour rester lisible dans le PDF. */
    const texteDe = (m: any, max = 180): string => {
      const brut = String(m.content ?? "").replace(/\s+/g, " ").trim();
      if (!brut) return m.attachment_name ? "" : " : (message vide)";
      return ` : « ${brut.length > max ? `${brut.slice(0, max - 1)}…` : brut} »`;
    };
    const supp = (m: any) => (m.deleted_at ? " [message supprimé depuis]" : "");

    // 1) Messagerie client (fil par client)
    const parClient = new Map<string, any[]>();
    for (const m of cliRows) {
      const arr = parClient.get(m.client_id) ?? [];
      arr.push(m);
      parClient.set(m.client_id, arr);
    }
    for (const [cid, list] of parClient) {
      const client = clientLabel(cid) ?? nomDe(cid);
      const intervenants = [...new Set(list.filter((m) => m.from_agence).map((m) => nomDe(m.sender_id)))];
      messagerie.push({
        canal: `Client — ${client}`,
        type: "Client",
        participants: intervenants.length ? `Côté agence : ${intervenants.join(", ")}` : "Aucune réponse de l'agence",
        total: list.length,
        lignes: list.slice(0, 12).map((m) =>
          m.from_agence
            ? `${heureParis(m.created_at)} — ${nomDe(m.sender_id)} (agence) → ${client}${texteDe(m)}${piece(m)}${supp(m)}`
            : `${heureParis(m.created_at)} — ${nomDe(m.sender_id)} (client) → équipe agence${texteDe(m)}${piece(m)}${supp(m)}`,
        ),
      });
      for (const m of list) collectPiece(m, "chat-files", `Client — ${client}`);
      for (const m of list) {
        if (!m.from_agence || !m.sender_id || !nameById.has(m.sender_id)) continue;
        pushEvent(
          poleOfUser(m.sender_id),
          nomDe(m.sender_id),
          new Date(m.created_at).getTime(),
          heureParis(m.created_at),
          `Message envoyé à ${client}${texteDe(m, 90)}${piece(m)}`,
        );
      }
    }

    // 2) Messagerie interne (fils d'équipe / directs)
    const intConvMap = new Map(((intConvs ?? []) as any[]).map((c) => [c.id, c]));
    const parInt = new Map<string, any[]>();
    for (const m of intRows) {
      const arr = parInt.get(m.conversation_id) ?? [];
      arr.push(m);
      parInt.set(m.conversation_id, arr);
    }
    for (const [convId, list] of parInt) {
      const c: any = intConvMap.get(convId);
      const direct = c && c.is_group === false;
      const membres = membresDe((intMembers ?? []) as any[], convId);
      const nomCanal = c?.titre
        || (direct ? membres.join(" ↔ ") : null)
        || (c?.client_id ? clientLabel(c.client_id) ?? nomDe(c.client_id) : null)
        || (c?.pole_id ? poleNames.get(c.pole_id) ?? "Fil d'équipe" : "Fil d'équipe");
      messagerie.push({
        canal: `Interne — ${nomCanal}`,
        type: "Interne",
        participants: membres.length ? `Participants : ${membres.join(", ")}` : null,
        total: list.length,
        lignes: list.slice(0, 12).map((m) => {
          const dest = direct
            ? membresDe((intMembers ?? []) as any[], convId, m.sender_id).join(", ") || nomCanal
            : nomCanal;
          return `${heureParis(m.created_at)} — ${nomDe(m.sender_id)} → ${dest}${texteDe(m)}${piece(m)}${supp(m)}`;
        }),
      });
      for (const m of list) collectPiece(m, "internal-chat-files", `Interne — ${nomCanal}`);
      for (const m of list) {
        if (!m.sender_id || !nameById.has(m.sender_id)) continue;
        const dest = direct
          ? membresDe((intMembers ?? []) as any[], convId, m.sender_id).join(", ") || nomCanal
          : nomCanal;
        pushEvent(
          poleOfUser(m.sender_id),
          nomDe(m.sender_id),
          new Date(m.created_at).getTime(),
          heureParis(m.created_at),
          `Message interne à ${dest}${texteDe(m, 90)}${piece(m)}`,
        );
      }
    }

    // 3) Messagerie de groupe (clients + agence)
    const grpConvMap = new Map(((grpConvs ?? []) as any[]).map((c) => [c.id, c]));
    const parGrp = new Map<string, any[]>();
    for (const m of grpRows) {
      const arr = parGrp.get(m.conversation_id) ?? [];
      arr.push(m);
      parGrp.set(m.conversation_id, arr);
    }
    for (const [convId, list] of parGrp) {
      const nomCanal = (grpConvMap.get(convId) as any)?.titre ?? "Groupe";
      const membres = membresDe((grpMembers ?? []) as any[], convId);
      messagerie.push({
        canal: `Groupe — ${nomCanal}`,
        type: "Groupe",
        participants: membres.length ? `Participants : ${membres.join(", ")}` : null,
        total: list.length,
        lignes: list.slice(0, 12).map(
          (m) => `${heureParis(m.created_at)} — ${nomDe(m.sender_id)} → groupe « ${nomCanal} »${texteDe(m)}${piece(m)}${supp(m)}`,
        ),
      });
      for (const m of list) collectPiece(m, "chat-files", `Groupe — ${nomCanal}`);
      for (const m of list) {
        if (!m.sender_id || !nameById.has(m.sender_id)) continue;
        pushEvent(
          poleOfUser(m.sender_id),
          nomDe(m.sender_id),
          new Date(m.created_at).getTime(),
          heureParis(m.created_at),
          `Message dans le groupe « ${nomCanal} »${texteDe(m, 90)}${piece(m)}`,
        );
      }
    }
    messagerie.sort((a, b) => b.total - a.total);
  } catch (e) {
    console.error("[rapport-activite] messagerie detaillee indisponible", e);
  }

  /* ---- Pièces jointes hors messagerie : tâches et documents déposés ---- */
  try {
    const [{ data: taskFiles }, { data: docFiles }] = await Promise.all([
      admin
        .from("agency_task_attachments")
        .select("id, task_id, uploaded_by, storage_path, filename, mime_type, created_at")
        .gte("created_at", fromIso).lte("created_at", toIso)
        .order("created_at", { ascending: true }).limit(500),
      admin
        .from("documents")
        .select("id, dossier_id, uploader_id, nom, storage_path, mime_type, created_at")
        .gte("created_at", fromIso).lte("created_at", toIso)
        .order("created_at", { ascending: true }).limit(500),
    ]);
    const taskRows = (taskFiles ?? []) as any[];
    const docRows = (docFiles ?? []) as any[];

    const taskIds = [...new Set(taskRows.map((r) => r.task_id).filter(Boolean))];
    const dossierIds = [...new Set(docRows.map((r) => r.dossier_id).filter(Boolean))];
    const [{ data: tasksInfo }, { data: dossiersInfo }] = await Promise.all([
      taskIds.length
        ? admin.from("agency_tasks").select("id, titre").in("id", taskIds)
        : Promise.resolve({ data: [] } as any),
      dossierIds.length
        ? admin.from("dossiers").select("id, titre").in("id", dossierIds)
        : Promise.resolve({ data: [] } as any),
    ]);
    const titreTache = new Map(((tasksInfo ?? []) as any[]).map((t) => [t.id, t.titre]));
    const titreDossier = new Map(((dossiersInfo ?? []) as any[]).map((d) => [d.id, d.titre]));

    // Compléter les noms d'auteurs manquants.
    const besoin = new Set<string>();
    for (const r of [...taskRows, ...docRows]) {
      const uid = r.uploaded_by ?? r.uploader_id;
      if (uid && !nameById.has(uid)) besoin.add(uid);
    }
    if (besoin.size) {
      const { data: extra } = await admin
        .from("profiles").select("id, prenom, nom, email, entreprise").in("id", [...besoin]);
      for (const p of ((extra ?? []) as any[]))
        nameById.set(p.id, `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.entreprise || p.email || "—");
    }
    const nom2 = (id: any) => (id ? nameById.get(id) ?? "Utilisateur inconnu" : "—");

    for (const r of taskRows) {
      if (!r.storage_path && !r.filename) continue;
      piecesBrutes.push({
        at: new Date(r.created_at).getTime(),
        heure: heureParis(r.created_at) ?? "",
        canal: `Tâche — ${titreTache.get(r.task_id) ?? "tâche"}`,
        auteur: nom2(r.uploaded_by),
        nom: String(r.filename ?? "fichier"),
        bucket: "task-files",
        path: r.storage_path ?? null,
        mime: r.mime_type ?? null,
      });
    }
    for (const r of docRows) {
      if (!r.storage_path && !r.nom) continue;
      piecesBrutes.push({
        at: new Date(r.created_at).getTime(),
        heure: heureParis(r.created_at) ?? "",
        canal: `Document — ${titreDossier.get(r.dossier_id) ?? "dossier"}`,
        auteur: nom2(r.uploader_id),
        nom: String(r.nom ?? "document"),
        bucket: "documents",
        path: r.storage_path ?? null,
        mime: r.mime_type ?? null,
      });
    }
  } catch (e) {
    console.error("[rapport-activite] pieces jointes taches/documents indisponibles", e);
  }

  /* ---- Pièces jointes du jour : aperçu direct des images dans le PDF ----
   * Les images (JPEG/PNG) sont téléchargées puis encodées en data URL pour être
   * dessinées telles quelles dans le PDF. Les autres fichiers (PDF, Word…) sont
   * listés avec un lien signé pour être ouverts d'un clic depuis le compte rendu. */
  const MAX_IMAGES_PDF = 20;      // au-delà, la vignette est remplacée par une ligne
  const MAX_PIECES_PDF = 200;     // plafond global de la liste
  const MAX_OCTETS_IMAGE = 2_500_000;

  /** Format jsPDF de l'image, d'après le type MIME puis l'extension. */
  const formatImage = (mime: string | null, nom: string): "JPEG" | "PNG" | null => {
    const m = (mime ?? "").toLowerCase();
    if (m === "image/jpeg" || m === "image/jpg") return "JPEG";
    if (m === "image/png") return "PNG";
    const ext = nom.toLowerCase().split(".").pop() ?? "";
    if (ext === "jpg" || ext === "jpeg") return "JPEG";
    if (ext === "png") return "PNG";
    return null;
  };
  try {
    piecesBrutes.sort((a, b) => a.at - b.at);

    // Lien signé (30 jours) pour chaque fichier : le PDF devient cliquable, y compris
    // pour les PDF, Word, Excel… qui ne peuvent pas être dessinés en vignette.
    const urlByKey = new Map<string, string>();
    const parBucket = new Map<string, string[]>();
    for (const pj of piecesBrutes.slice(0, MAX_PIECES_PDF)) {
      if (!pj.path) continue;
      const arr = parBucket.get(pj.bucket) ?? [];
      if (!arr.includes(pj.path)) arr.push(pj.path);
      parBucket.set(pj.bucket, arr);
    }
    for (const [bucket, paths] of parBucket) {
      try {
        const { data } = await admin.storage.from(bucket).createSignedUrls(paths, 60 * 60 * 24 * 30);
        for (const s of (data ?? []) as any[])
          if (s?.signedUrl && s?.path) urlByKey.set(`${bucket}::${s.path}`, s.signedUrl);
      } catch (err) {
        console.error(`[rapport-activite] liens signes indisponibles (${bucket})`, err);
      }
    }

    let imagesRetenues = 0;
    for (const pj of piecesBrutes.slice(0, MAX_PIECES_PDF)) {
      const base = {
        heure: pj.heure,
        canal: pj.canal,
        auteur: pj.auteur,
        nom: pj.nom,
        url: pj.path ? urlByKey.get(`${pj.bucket}::${pj.path}`) ?? null : null,
      };
      const format = formatImage(pj.mime, pj.nom);
      if (!format || !pj.path || imagesRetenues >= MAX_IMAGES_PDF) {
        piecesJointes.push({ ...base, dataUrl: null, format: null });
        continue;
      }
      try {
        const { data, error } = await admin.storage.from(pj.bucket).download(pj.path);
        if (error || !data) throw error ?? new Error("fichier introuvable");
        const octets = Buffer.from(await data.arrayBuffer());
        if (octets.byteLength > MAX_OCTETS_IMAGE) {
          piecesJointes.push({ ...base, dataUrl: null, format: null });
          continue;
        }
        const mime = format === "PNG" ? "image/png" : "image/jpeg";
        piecesJointes.push({
          ...base,
          dataUrl: `data:${mime};base64,${octets.toString("base64")}`,
          format,
        });
        imagesRetenues++;
      } catch (err) {
        // Fichier illisible ou supprimé : on garde la trace, sans aperçu.
        console.error(`[rapport-activite] piece jointe illisible (${pj.bucket}/${pj.path})`, err);
        piecesJointes.push({ ...base, dataUrl: null, format: null });
      }
    }
  } catch (e) {
    console.error("[rapport-activite] pieces jointes indisponibles", e);
  }


  const journeePoles = [...evByPolePerson.entries()]
    .map(([pole, perPerson]) => ({
      pole,
      poleId: poleIdByName.get(pole) ?? null,
      personnes: [...perPerson.entries()]
        .map(([nom, evs]) => ({
          nom,
          evenements: evs
            .sort((a, b) => a.at - b.at)
            .map((e) => ({ heure: e.heure, texte: e.texte })),
        }))
        .sort((a, b) => b.evenements.length - a.evenements.length || a.nom.localeCompare(b.nom)),
    }))
    .filter((p) => p.personnes.length > 0)
    .sort((a, b) => {
      if (a.pole === SANS_POLE) return 1;
      if (b.pole === SANS_POLE) return -1;
      return a.pole.localeCompare(b.pole);
    });

  const enRetardTotal = retenues.filter((t) => etatOfTask(t) === "En retard").length;
  const plusAnciennes = priorites
    .filter((p) => p.etat === "En retard")
    .slice(0, 3)
    .map((p) => `${p.titre}${p.joursRetard != null ? ` (${p.joursRetard} j)` : ""}`);

  const journee: DigestJournee = {
    poles: journeePoles,
    echanges: echangesJour.sort((a, b) => a.pole.localeCompare(b.pole)),
    messagerie,
    piecesJointes,
    retards: { total: enRetardTotal, plusAnciennes },
    presence: personnes
      .filter((p) => p.presence.seconds > 0)
      .map((p) => ({ nom: p.nom, duree: p.presence.dureeLabel, plage: p.presence.plage })),
    absents: personnes.filter((p) => p.presence.seconds === 0).map((p) => p.nom),
    chiffres: {
      tachesTerminees: personnes.reduce((n, p) => n + p.taches.done.length, 0),
      dossiersCrees,
      documentsDeposes,
      messages: msgC + msgI + msgG,
      personnesActives: new Set(journeePoles.flatMap((p) => p.personnes.map((x) => x.nom))).size,
    },
    calme: journeePoles.length === 0,
  };

  return {
    dateFr,
    periode,
    synthese: {
      connectes,
      equipe: personnes.length,
      tempsCumule: fmtDuree(tempsCumuleSec),
      tachesTerminees: personnes.reduce((n, p) => n + p.taches.done.length, 0),
      tachesEnCours: personnes.reduce((n, p) => n + p.taches.inProgress.length, 0),
      tachesEnRetard: personnes.reduce((n, p) => n + p.taches.overdue.length, 0),
      dossiersCrees,
      changementsStatut,
      documentsDeposes,
      messages: msgC + msgI + msgG,
      nouveauxClients,
    },
    classement: personnes
      .map((p) => ({ nom: p.nom, done: p.taches.done.length }))
      .filter((x) => x.done > 0)
      .slice(0, 10),
    personnes,
    poleSections,
    priorites,
    journee,
  };
}

export const DIGEST_BUCKET = "rapports-quotidiens";

/** Chemin de stockage du PDF du jour : {AAAA}/{MM}/compte-rendu-{AAAA-MM-JJ}.pdf */
export function digestPdfPath(dayKey: string): string {
  const [y, m] = dayKey.split("-");
  return `${y}/${m}/compte-rendu-${dayKey}.pdf`;
}

/**
 * Génère le PDF depuis le digest déjà calculé, le téléverse et renvoie une URL signée 30 jours.
 * Ne lève jamais : en cas d'échec, renvoie null pour que l'e-mail parte quand même.
 */
async function buildAndStoreDigestPdf(
  admin: any,
  digest: DailyDigest,
  dayKey: string,
): Promise<string | null> {
  try {
    const { buildDailyDigestPdf } = await import("@/lib/daily-digest-pdf.server");
    const bytes = await buildDailyDigestPdf(digest);
    const path = digestPdfPath(dayKey);
    const { error: upErr } = await admin.storage
      .from(DIGEST_BUCKET)
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) throw upErr;
    const { data, error } = await admin.storage
      .from(DIGEST_BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 30);
    if (error) throw error;
    return data?.signedUrl ?? null;
  } catch (e) {
    console.error("[pdf] génération/téléversement du compte rendu en échec", e);
    return null;
  }
}

/**
 * Envoi du compte rendu quotidien (idempotent par jour + destinataire).
 * `to` : envoi de test vers cette seule adresse — email_settings est ignoré
 * et n'est jamais modifié.
 */
export async function sendDailyDigest(
  admin: any,
  baseUrl?: string,
  to?: string,
): Promise<{ ok: boolean; recipients: string[]; date: string; pdfUrl: string | null; error?: string }> {
  const digest = await buildDailyDigest(admin);
  const dayKey = parisDateKey();
  const pdfUrl = await buildAndStoreDigestPdf(admin, digest, dayKey);

  if (to) {
    const base = baseUrl || APP_URL;
    let ok = false;
    let errorText: string | null = null;
    try {
      const res = await sendAppEmail({
        templateName: "compte-rendu-quotidien",
        recipientEmail: to,
        idempotencyKey: `rapport-activite-test-${dayKey}-${to}-${Date.now()}`,
        templateData: { ...digest, pdfUrl, appUrl: APP_URL },
      });
      ok = res.success;
      if (!ok) errorText = `${(res as any).reason}${(res as any).error ? ` ${(res as any).error}` : ""}`.slice(0, 500);
    } catch (e) {
      errorText = String(e).slice(0, 500);
    }
    try {
      await admin.from("supervision_emails").insert({
        type: "rapport_activite_test",
        recipient: to,
        status: ok ? "sent" : "failed",
        error: errorText,
      });
    } catch (e) {
      console.error("[rapport-activite-test] log failed", e);
    }
    return { ok, recipients: [to], date: dayKey, pdfUrl, ...(errorText ? { error: errorText } : {}) };
  }

  // Le compte rendu quotidien a ses propres destinataires (admin + report_recipients),
  // distincts de ceux de l'Agent IA de supervision.
  const { recipients } = await resolveReportRecipients(admin);
  const ok = await sendSupervisionEmail(admin, {
    templateName: "compte-rendu-quotidien",
    type: "rapport_activite",
    idempotencyKey: `rapport-activite-${dayKey}`,
    baseUrl,
    recipients,
    templateData: { ...digest, pdfUrl } as unknown as Record<string, unknown>,
  });
  return { ok, recipients, date: dayKey, pdfUrl };
}


/**
 * Regénère le PDF archivé d'une journée passée avec la mise en page courante.
 * Écrase le fichier existant dans le bucket et renvoie une URL signée.
 */
export async function regenerateDigestPdf(
  admin: any,
  dayKey: string,
): Promise<{ ok: boolean; date: string; pdfUrl: string | null }> {
  const digest = await buildDailyDigest(admin, new Date(`${dayKey}T12:00:00Z`));
  const pdfUrl = await buildAndStoreDigestPdf(admin, digest, dayKey);
  return { ok: pdfUrl !== null, date: dayKey, pdfUrl };
}

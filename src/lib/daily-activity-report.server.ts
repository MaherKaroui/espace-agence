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
  const weekday = parisWeekday(now);

  // Lundi : on inclut le week-end écoulé.
  const daysBack = weekday === "Mon" ? 3 : 1;
  const startKey = parisDateKey(new Date(now.getTime() - (daysBack - 1) * 86400_000));
  const from = parisInstant(startKey, 0);
  const to = now;
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const periode =
    daysBack > 1
      ? `du ${new Date(from).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} au ${now.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}`
      : now.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });

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
      const res = await fetch(`${APP_URL}/lovable/email/transactional/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          templateName: "rapport-activite",
          recipientEmail: recipient,
          idempotencyKey: `rapport-activite-${dayKey}-${recipient}`,
          templateData: { ...report, appUrl: APP_URL },
        }),
      });
      ok = res.ok;
      if (!ok) errorText = `${res.status} ${await res.text().catch(() => "")}`.slice(0, 500);
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

export interface DigestPerson {
  nom: string;
  roles: string[];
  poles: string[];
  presence: {
    dureeLabel: string;
    seconds: number;
    premiere: string | null;
    derniere: string | null;
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
}

export interface DigestPoleSection {
  pole: string;
  ouvertes: number;
  termineesJour: number;
  enRetard: number;
  collaborateurs: number;
  taches: DigestTaskRow[];
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

  const weekday = parisWeekday(now);
  const daysBack = weekday === "Mon" ? 3 : 1;
  const startKey = parisDateKey(new Date(now.getTime() - (daysBack - 1) * 86400_000));
  const from = parisInstant(startKey, 0);
  const fromIso = from.toISOString();
  const toIso = now.toISOString();
  const dateFr = now.toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const periode =
    daysBack > 1
      ? `du ${from.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} au ${now.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} (week-end inclus)`
      : `${now.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}, de 00h00 à ${heureParis(toIso)}`;

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
        "id, title, priority, status, due_date, completed_at, created_at, client_id, dossier_id, internal_comment, assigned_to",
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

  const poleIds = [...new Set(((poleMembers ?? []) as any[]).map((p) => p.pole_id))];
  const { data: poles } = poleIds.length
    ? await admin.from("poles").select("id, nom").in("id", poleIds)
    : ({ data: [] } as any);
  const poleNames = new Map(((poles ?? []) as any[]).map((p) => [p.id, p.nom]));
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

  // --- Commentaires de tâches ajoutés pendant la période (auteur + heure) ---
  const commentsByTask = new Map<string, string[]>();
  try {
    if (taskList.length) {
      const { data: taskComments } = await admin
        .from("agency_task_comments")
        .select("task_id, user_id, content, created_at")
        .in("task_id", taskList.map((t) => t.id))
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true })
        .limit(3000);
      const rows = (taskComments ?? []) as any[];
      const authorIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
      const { data: authors } = authorIds.length
        ? await admin.from("profiles").select("id, prenom, nom, email").in("id", authorIds)
        : ({ data: [] } as any);
      const aMap = new Map(
        ((authors ?? []) as any[]).map((a) => [
          a.id,
          `${a.prenom ?? ""} ${a.nom ?? ""}`.trim() || a.email || "—",
        ]),
      );
      for (const r of rows) {
        const arr = commentsByTask.get(r.task_id) ?? [];
        const texte = String(r.content ?? "").trim();
        if (!texte) continue;
        arr.push(`${heureParis(r.created_at)} ${aMap.get(r.user_id) ?? "—"} : ${texte}`);
        commentsByTask.set(r.task_id, arr);
      }
    }
  } catch (e) {
    console.error("[compte-rendu] commentaires de tâches indisponibles", e);
  }

  /** internal_comment + commentaires du jour, tronqués à ~200 caractères chacun. */
  const taskComments = (t: any): string | null => {
    const parts: string[] = [];
    const internal = String(t.internal_comment ?? "").trim();
    if (internal) parts.push(internal);
    parts.push(...(commentsByTask.get(t.id) ?? []));
    if (parts.length === 0) return null;
    return parts
      .slice(0, 4)
      .map((c) => (c.length > 200 ? `${c.slice(0, 197)}...` : c))
      .join("\n");
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
    // Présence
    const sess = sessionsByUser.get(p.id) ?? [];
    let seconds = 0;
    let premiere: number | null = null;
    let derniere: number | null = null;
    const lieux = new Set<string>();
    const appareils = new Set<string>();
    let sessionCount = 0;
    for (const s of sess) {
      const start = new Date(s.started_at).getTime();
      const endRaw = s.ended_at ?? s.last_seen_at ?? s.started_at;
      let end = new Date(endRaw).getTime();
      if (s.duration_seconds && !s.ended_at) end = Math.max(end, start + s.duration_seconds * 1000);
      const clippedStart = Math.max(start, windowStart);
      const clippedEnd = Math.min(end, windowEnd);
      if (clippedEnd <= clippedStart) continue;
      sessionCount++;
      seconds += (clippedEnd - clippedStart) / 1000;
      premiere = premiere === null ? clippedStart : Math.min(premiere, clippedStart);
      derniere = derniere === null ? clippedEnd : Math.max(derniere, clippedEnd);
      if (s.city) lieux.add(s.city);
      const dev = deviceLabel(s.user_agent);
      if (dev) appareils.add(dev);
    }

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

    // Actions (audit_logs)
    const myLogs = logsByUser.get(p.id) ?? [];
    const grouped = new Map<string, string[]>();
    for (const l of myLogs) {
      const g = actionGroup(l.action);
      if (!g) continue;
      const h = heureParis(l.created_at);
      const meta: any = l.metadata || {};
      let libelle: string | null = null;
      if (l.entity_type === "dossier") libelle = dossierLabel(l.entity_id);
      else if (l.entity_type === "document") libelle = docMap.get(l.entity_id)?.nom ?? null;
      if (!libelle) libelle = clientLabel(meta.client_id) ?? dossierLabel(meta.dossier_id);
      let suffix = "";
      if (l.action === "dossier.status_changed" && (meta.from || meta.old || meta.to || meta.new)) {
        suffix = ` (${meta.from ?? meta.old ?? "?"} → ${meta.to ?? meta.new ?? "?"})`;
      }
      const arr = grouped.get(g) ?? [];
      arr.push(`${h} — ${libelle ?? meta.titre ?? meta.title ?? "—"}${suffix}`);
      grouped.set(g, arr);
    }
    const actions = [...grouped.entries()].map(([label, items]) => ({
      label,
      count: items.length,
      items: items.slice(0, 10),
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

  const tempsCumuleSec = personnes.reduce((n, p) => n + p.presence.seconds, 0);

  return {
    dateFr,
    periode,
    synthese: {
      connectes: personnes.filter((p) => p.presence.seconds > 0).length,
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
      const res = await fetch(`${base}/lovable/email/transactional/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          templateName: "compte-rendu-quotidien",
          recipientEmail: to,
          idempotencyKey: `rapport-activite-test-${dayKey}-${to}-${Date.now()}`,
          templateData: { ...digest, pdfUrl, appUrl: APP_URL },
        }),
      });
      ok = res.ok;
      if (!ok) errorText = `${res.status} ${await res.text().catch(() => "")}`.slice(0, 500);
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

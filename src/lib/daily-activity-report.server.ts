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

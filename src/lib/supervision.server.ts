/**
 * Logique serveur de l'Agent IA de supervision.
 * Server-only : ne jamais importer depuis un composant.
 */
/**
 * Destinataires des e-mails de l'Agent IA de supervision (alertes + rapports techniques).
 * UNIQUEMENT l'adresse admin principale (email_settings.admin_email).
 * Les destinataires supplémentaires (report_recipients) ne reçoivent QUE le compte rendu
 * quotidien, résolu de son côté par resolveReportRecipients().
 */
export async function resolveSupervisionRecipients(admin: any): Promise<string[]> {
  try {
    const { data } = await admin
      .from("email_settings")
      .select("admin_email")
      .eq("id", 1)
      .maybeSingle();
    const raw = data?.admin_email;
    if (typeof raw !== "string" || !raw.includes("@")) return [];
    const email = raw.trim().toLowerCase();
    const { data: suppressed } = await admin.from("suppressed_emails").select("email").eq("email", email);
    if (((suppressed ?? []) as any[]).length > 0) return [];
    return [email];
  } catch (e) {
    console.error("[supervision] recipients failed", e);
    return [];
  }
}

export const APP_URL = "https://izisuivis.com";

export interface Anomaly {
  kind: string;
  label: string;
  gravite: "critique" | "majeur" | "mineur";
  count: number;
  details: unknown[];
}

function iso(daysAgo: number) {
  return new Date(Date.now() - daysAgo * 86400_000).toISOString();
}

/** Analyse quotidienne de la qualité des données. Chaque contrôle est isolé. */
export async function computeAnomalies(admin: any): Promise<Anomaly[]> {
  const out: Anomaly[] = [];
  const push = (a: Anomaly) => { if (a.count > 0) out.push(a); };
  const safe = async (fn: () => Promise<void>, kind: string) => {
    try { await fn(); } catch (e) { console.error("[supervision] anomaly failed", kind, e); }
  };

  const { data: tasks } = await admin
    .from("agency_tasks")
    .select("id, title, status, assigned_to, due_date, completed_at, archived_at, client_id, dossier_id")
    .is("archived_at", null)
    .limit(2000);
  const open = ((tasks ?? []) as any[]).filter((t) => !t.completed_at);

  await safe(async () => {
    const rows = open.filter((t) => !t.assigned_to);
    push({ kind: "tasks_no_assignee", label: "Tâches sans responsable assigné", gravite: "majeur", count: rows.length, details: rows.slice(0, 20).map((t) => ({ id: t.id, title: t.title })) });
  }, "tasks_no_assignee");

  await safe(async () => {
    const rows = open.filter((t) => !t.due_date);
    push({ kind: "tasks_no_due_date", label: "Tâches sans date d'échéance", gravite: "mineur", count: rows.length, details: rows.slice(0, 20).map((t) => ({ id: t.id, title: t.title })) });
  }, "tasks_no_due_date");

  await safe(async () => {
    const limit = iso(7);
    const rows = open.filter((t) => t.due_date && t.due_date < limit);
    push({ kind: "tasks_overdue_7d", label: "Tâches en retard depuis plus de 7 jours", gravite: "critique", count: rows.length, details: rows.slice(0, 20).map((t) => ({ id: t.id, title: t.title, due_date: t.due_date })) });
  }, "tasks_overdue_7d");

  await safe(async () => {
    const seen = new Map<string, number>();
    for (const t of open) {
      const k = `${(t.title ?? "").trim().toLowerCase()}|${t.dossier_id ?? t.client_id ?? ""}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    const dups = [...seen.entries()].filter(([, n]) => n > 1);
    push({ kind: "tasks_duplicates", label: "Tâches en double (même titre, même dossier)", gravite: "mineur", count: dups.length, details: dups.slice(0, 20).map(([k, n]) => ({ key: k, count: n })) });
  }, "tasks_duplicates");

  await safe(async () => {
    const counts = new Map<string, number>();
    for (const t of open) if (t.assigned_to) counts.set(t.assigned_to, (counts.get(t.assigned_to) ?? 0) + 1);
    const overloaded = [...counts.entries()].filter(([, n]) => n >= 15);
    push({ kind: "overloaded_members", label: "Collaborateurs surchargés (15+ tâches ouvertes)", gravite: "majeur", count: overloaded.length, details: overloaded.map(([id, n]) => ({ user_id: id, open_tasks: n })) });
  }, "overloaded_members");

  await safe(async () => {
    const { data: dossiers } = await admin.from("dossiers").select("id, titre, client_id, organisme_email, organisme_telephone").is("archived_at", null).limit(2000);
    const list = (dossiers ?? []) as any[];
    const clientsWithDossier = new Set(list.map((d) => d.client_id));
    const { data: clientRoles } = await admin.from("user_roles").select("user_id").eq("role", "client").limit(2000);
    const withoutDossier = ((clientRoles ?? []) as any[]).filter((r) => !clientsWithDossier.has(r.user_id));
    push({ kind: "clients_without_dossier", label: "Clients sans aucun dossier", gravite: "mineur", count: withoutDossier.length, details: withoutDossier.slice(0, 20) });

    const incomplete = list.filter((d) => !d.organisme_email || !d.organisme_telephone);
    push({ kind: "dossiers_incomplete", label: "Dossiers avec champs obligatoires vides (email / téléphone OF)", gravite: "majeur", count: incomplete.length, details: incomplete.slice(0, 20).map((d) => ({ id: d.id, titre: d.titre })) });

    const dossiersWithTask = new Set(open.map((t) => t.dossier_id).filter(Boolean));
    const noTask = list.filter((d) => !dossiersWithTask.has(d.id));
    push({ kind: "dossiers_without_task", label: "Dossiers sans aucune tâche ouverte", gravite: "mineur", count: noTask.length, details: noTask.slice(0, 20).map((d) => ({ id: d.id, titre: d.titre })) });
  }, "dossiers");

  await safe(async () => {
    const { data: profiles } = await admin.from("profiles").select("id, email").is("archived_at", null).limit(2000);
    const { data: sessions } = await admin.from("user_sessions").select("user_id, last_seen_at").gte("last_seen_at", iso(30)).limit(5000);
    const active = new Set(((sessions ?? []) as any[]).map((s) => s.user_id));
    const inactive = ((profiles ?? []) as any[]).filter((p) => !active.has(p.id));
    push({ kind: "inactive_users", label: "Utilisateurs inactifs depuis plus de 30 jours", gravite: "mineur", count: inactive.length, details: inactive.slice(0, 20).map((p) => ({ id: p.id, email: p.email })) });
  }, "inactive_users");

  return out;
}

export async function persistAnomalies(admin: any, anomalies: Anomaly[]) {
  const today = new Date().toISOString().slice(0, 10);
  for (const a of anomalies) {
    try {
      await admin.from("data_anomalies").upsert(
        { check_date: today, kind: a.kind, label: a.label, gravite: a.gravite, count: a.count, details: a.details },
        { onConflict: "check_date,kind" },
      );
    } catch (e) {
      console.error("[supervision] persist anomaly failed", a.kind, e);
    }
  }
}

/** Envoi d'un email de supervision + traçabilité dans supervision_emails. */
export async function sendSupervisionEmail(
  admin: any,
  opts: {
    templateName: string;
    type: string;
    templateData: Record<string, unknown>;
    idempotencyKey: string;
    /** Origine du déploiement courant (preview ou prod). Défaut : APP_URL. */
    baseUrl?: string;
    /** Destinataires explicites (ex. compte rendu quotidien). Défaut : adresse admin principale. */
    recipients?: string[];
  },
): Promise<boolean> {
  const recipients = opts.recipients?.length
    ? opts.recipients
    : await resolveSupervisionRecipients(admin);
  if (recipients.length === 0) {
    console.error("[supervision] aucun destinataire configuré dans email_settings");
    return false;
  }

  let allOk = true;
  for (const recipient of recipients) {
    let ok = false;
    let errorText: string | null = null;
    try {
      const base = opts.baseUrl || APP_URL;
      const res = await fetch(`${base}/lovable/email/transactional/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({
          templateName: opts.templateName,
          recipientEmail: recipient,
          idempotencyKey: `${opts.idempotencyKey}-${recipient}`,
          templateData: { ...opts.templateData, appUrl: APP_URL },
        }),
      });
      ok = res.ok;
      if (!ok) errorText = `${res.status} ${await res.text().catch(() => "")}`.slice(0, 500);
    } catch (e) {
      errorText = String(e).slice(0, 500);
    }
    if (!ok) allOk = false;
    try {
      await admin.from("supervision_emails").insert({
        type: opts.type,
        recipient,
        status: ok ? "sent" : "failed",
        error: errorText,
      });
    } catch (e) {
      console.error("[supervision] log email failed", e);
    }
  }
  return allOk;
}

/** Alerte immédiate avec anti-spam : 1 alerte / heure pour une même clé. */
export async function sendImmediateAlert(
  admin: any,
  alertKey: string,
  data: { titre: string; detail?: string; gravite?: string; page?: string },
): Promise<boolean> {
  try {
    const { data: recent } = await admin
      .from("supervision_alerts")
      .select("id")
      .eq("alert_key", alertKey)
      .gte("created_at", new Date(Date.now() - 3600_000).toISOString())
      .limit(1);
    if ((recent ?? []).length > 0) return false;
    await admin.from("supervision_alerts").insert({ alert_key: alertKey });
  } catch (e) {
    console.error("[supervision] alert throttle failed", e);
  }
  return sendSupervisionEmail(admin, {
    templateName: "supervision-alerte",
    type: "alerte",
    idempotencyKey: `alert-${alertKey}-${Math.floor(Date.now() / 3600_000)}`,
    templateData: {
      ...data,
      gravite: data.gravite ?? "critique",
      dateFr: new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" }),
    },
  });
}

/** Vrai uniquement si l'heure locale Europe/Paris correspond. */
export function isParisHour(hour: number, minute?: number): boolean {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  if (h !== hour) return false;
  if (minute === undefined) return true;
  return Math.abs(m - minute) <= 10;
}

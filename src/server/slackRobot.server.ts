// Robot de collecte Slack par API.
// Contrainte forte : application Slack récente → `conversations.history` et
// `conversations.replies` sont plafonnées à ~1 requête / minute et 15 objets
// par requête. Le robot est donc conçu pour avancer par petits pas, appelé
// chaque minute par la tâche planifiée, avec reprise exacte par curseur.

const SLACK_API = "https://slack.com/api";

/** Nombre d'objets par page imposé par la limitation des applications récentes. */
export const PAGE_SIZE = 15;
/** Appels soumis à la limitation autorisés par passage (1 par minute). */
const RATE_LIMITED_CALLS_PER_TICK = 1;
/** Fichiers téléchargés par passage (endpoint non soumis à la même limite). */
const FILES_PER_TICK = 3;

export function botToken(): string {
  const t = process.env['SLACK_BOT_TOKEN'];
  if (!t) throw new Error("SLACK_BOT_TOKEN n'est pas configuré dans les secrets du projet");
  return t;
}

class RateLimited extends Error {
  constructor(public retryAfter: number) {
    super(`Limite de débit Slack atteinte, reprise dans ${retryAfter}s`);
  }
}

async function slack(method: string, params: Record<string, string> = {}): Promise<any> {
  const url = `${SLACK_API}/${method}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken()}` } });
  if (res.status === 429) {
    // On respecte STRICTEMENT l'en-tête Retry-After : aucun réessai immédiat.
    const ra = Number(res.headers.get("retry-after") ?? "60");
    throw new RateLimited(Number.isFinite(ra) && ra > 0 ? ra : 60);
  }
  if (!res.ok) throw new Error(`Slack ${method} : HTTP ${res.status}`);
  const body: any = await res.json();
  if (!body.ok) {
    if (body.error === "ratelimited") throw new RateLimited(60);
    throw new Error(`Slack ${method} : ${body.error ?? "erreur inconnue"}`);
  }
  return body;
}

/* ------------------------------------------------------------------ */
/* Configuration / diagnostic                                          */
/* ------------------------------------------------------------------ */

export async function robotAuthTest() {
  const b = await slack("auth.test");
  return { team: b.team as string, bot: b.user as string, url: b.url as string };
}

export type RobotChannel = {
  slack_channel_id: string;
  nom: string;
  type: string;
  is_member: boolean;
  membres_count: number;
};

export async function robotListChannels(): Promise<RobotChannel[]> {
  const out: RobotChannel[] = [];
  let cursor = "";
  for (let i = 0; i < 20; i++) {
    const b = await slack("conversations.list", {
      types: "public_channel,private_channel",
      exclude_archived: "false",
      limit: "200",
      ...(cursor ? { cursor } : {}),
    });
    for (const c of b.channels ?? []) {
      out.push({
        slack_channel_id: c.id,
        nom: c.name ?? c.id,
        type: c.is_private ? "prive" : "public",
        is_member: !!c.is_member,
        membres_count: c.num_members ?? 0,
      });
    }
    cursor = b.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return out.sort((a, b) => a.nom.localeCompare(b.nom));
}

/** Rapatrie l'annuaire des membres (endpoint non plafonné à 1/min). */
export async function robotSyncMembres(supabase: any) {
  let cursor = "";
  let n = 0;
  for (let i = 0; i < 10; i++) {
    const b = await slack("users.list", { limit: "200", ...(cursor ? { cursor } : {}) });
    const rows = (b.members ?? []).map((m: any) => ({
      slack_user_id: m.id,
      nom: m.profile?.real_name ?? m.real_name ?? m.name ?? null,
      display_name: m.profile?.display_name || m.name || null,
      email: m.profile?.email ?? null,
      avatar_url: m.profile?.image_192 ?? null,
      is_bot: !!m.is_bot,
    }));
    if (rows.length) {
      const { error } = await supabase
        .from("slack_membres")
        .upsert(rows, { onConflict: "slack_user_id" });
      if (error) throw error;
      n += rows.length;
    }
    cursor = b.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return { membres: n };
}

/* ------------------------------------------------------------------ */
/* État du travail (réutilise slack_imports, mode = 'api')             */
/* ------------------------------------------------------------------ */

export type RobotMeta = {
  phase?: string;
  cooldown_until?: string | null;
  lease_until?: string | null;
  derniere_erreur?: string | null;
  files_cursor?: string | null;
  files_indexed?: boolean;
  threads?: { c: string; ts: string; cur?: string | null }[];
  estimation_total?: number;
  canal_courant?: string | null;
};

const JOB_COLS =
  "id, statut, mode, messages_count, fichiers_count, fichiers_taille, canaux_count, membres_count, fichiers_traites, created_at, updated_at";

export async function currentJob(supabase: any) {
  const { data, error } = await supabase
    .from("slack_imports")
    .select(JOB_COLS)
    .eq("mode", "api")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function patchJob(supabase: any, id: string, patch: Record<string, unknown>) {
  const { error } = await supabase
    .from("slack_imports")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

async function patchMeta(supabase: any, job: any, meta: RobotMeta) {
  const merged = { ...(job.fichiers_traites ?? {}), ...meta };
  job.fichiers_traites = merged;
  await patchJob(supabase, job.id, { fichiers_traites: merged });
}

/** Démarre (ou relance) une collecte sur les canaux sélectionnés. */
export async function robotStart(
  supabase: any,
  userId: string,
  channels: { slack_channel_id: string; nom: string; type: string; membres_count: number }[],
  estimationTotal: number,
) {
  // Les canaux sélectionnés sont créés/mis à jour, les autres désélectionnés.
  await supabase.from("slack_canaux").update({ collecte_selection: false }).neq("slack_channel_id", "");
  for (const c of channels) {
    const { data: existing } = await supabase
      .from("slack_canaux")
      .select("id")
      .eq("slack_channel_id", c.slack_channel_id)
      .maybeSingle();
    if (existing) {
      await supabase
        .from("slack_canaux")
        .update({ collecte_selection: true, nom: c.nom, type: c.type, collecte_erreur: null })
        .eq("id", existing.id);
    } else {
      await supabase.from("slack_canaux").insert({
        slack_channel_id: c.slack_channel_id,
        nom: c.nom,
        type: c.type,
        membres_count: c.membres_count ?? 0,
        collecte_selection: true,
      });
    }
  }

  const existingJob = await currentJob(supabase);
  const meta: RobotMeta = {
    phase: "fichiers",
    cooldown_until: null,
    lease_until: null,
    derniere_erreur: null,
    estimation_total: estimationTotal,
    threads: (existingJob?.fichiers_traites?.threads as any) ?? [],
    files_indexed: false,
    files_cursor: null,
  };
  if (existingJob) {
    await patchJob(supabase, existingJob.id, {
      statut: "en_cours",
      canaux_count: channels.length,
      fichiers_traites: { ...(existingJob.fichiers_traites ?? {}), ...meta },
    });
    return { id: existingJob.id as string };
  }
  const { data, error } = await supabase
    .from("slack_imports")
    .insert({
      archive_nom: "Robot API Slack",
      mode: "api",
      statut: "en_cours",
      canaux_count: channels.length,
      fichiers_traites: meta,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id as string };
}

export async function robotSetStatut(supabase: any, statut: "en_cours" | "pause" | "termine") {
  const job = await currentJob(supabase);
  if (!job) throw new Error("Aucune collecte n'a été créée.");
  await patchJob(supabase, job.id, {
    statut,
    fichiers_traites: { ...(job.fichiers_traites ?? {}), lease_until: null },
  });
  return { statut };
}

export async function robotStatus(supabase: any) {
  const job = await currentJob(supabase);
  const { data: canaux } = await supabase
    .from("slack_canaux")
    .select("id, nom, type, slack_channel_id, collecte_messages, collecte_terminee, collecte_erreur, collecte_last_at")
    .eq("collecte_selection", true)
    .order("nom");
  const { count: fichiersTotal } = await supabase
    .from("slack_fichiers")
    .select("id", { count: "exact", head: true });
  const { count: fichiersOk } = await supabase
    .from("slack_fichiers")
    .select("id", { count: "exact", head: true })
    .not("storage_path", "is", null);
  const { data: tailles } = await supabase
    .from("slack_fichiers")
    .select("taille, storage_path")
    .limit(5000);
  const volumeTotal = (tailles ?? []).reduce((s: number, f: any) => s + (f.taille ?? 0), 0);
  const volumeOk = (tailles ?? [])
    .filter((f: any) => f.storage_path)
    .reduce((s: number, f: any) => s + (f.taille ?? 0), 0);

  const meta: RobotMeta = job?.fichiers_traites ?? {};
  return {
    job: job
      ? {
          id: job.id as string,
          statut: job.statut as string,
          messages: (canaux ?? []).reduce((s: number, c: any) => s + (c.collecte_messages ?? 0), 0),
          estimation_total: meta.estimation_total ?? 0,
          phase: meta.phase ?? "messages",
          cooldown_until: meta.cooldown_until ?? null,
          derniere_erreur: meta.derniere_erreur ?? null,
          canal_courant: meta.canal_courant ?? null,
          threads_en_attente: (meta.threads ?? []).length,
        }
      : null,
    canaux: canaux ?? [],
    fichiers: {
      total: fichiersTotal ?? 0,
      recuperes: fichiersOk ?? 0,
      volume_total: volumeTotal,
      volume_recupere: volumeOk,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Collecte                                                            */
/* ------------------------------------------------------------------ */

async function canalIdFor(supabase: any, slackChannelId: string, nom?: string) {
  const { data } = await supabase
    .from("slack_canaux")
    .select("id")
    .eq("slack_channel_id", slackChannelId)
    .maybeSingle();
  if (data) return data.id as string;
  const { data: ins, error } = await supabase
    .from("slack_canaux")
    .insert({ slack_channel_id: slackChannelId, nom: nom ?? slackChannelId, type: "public" })
    .select("id")
    .single();
  if (error) throw error;
  return ins.id as string;
}

async function enregistreMessages(
  supabase: any,
  canalId: string,
  slackChannelId: string,
  messages: any[],
) {
  const rows = messages
    .filter((m) => m.ts)
    .map((m) => ({
      canal_id: canalId,
      slack_channel_id: slackChannelId,
      ts: String(m.ts),
      thread_ts: m.thread_ts ? String(m.thread_ts) : null,
      slack_user_id: m.user ?? m.bot_id ?? null,
      auteur: m.username ?? m.user_profile?.real_name ?? null,
      texte: m.text ?? null,
      reactions: m.reactions ?? null,
      files: m.files ? m.files.map((f: any) => ({ id: f.id, name: f.name })) : null,
      posted_at: new Date(Number(String(m.ts).split(".")[0]) * 1000).toISOString(),
    }));
  if (!rows.length) return 0;
  const { error } = await supabase
    .from("slack_messages")
    .upsert(rows, { onConflict: "slack_channel_id,ts", ignoreDuplicates: true });
  if (error) throw error;

  // Fichiers référencés dans les messages : on les recense pour téléchargement.
  const fichiers = messages.flatMap((m: any) =>
    (m.files ?? [])
      .filter((f: any) => f.id && !f.mode?.includes("tombstone"))
      .map((f: any) => ({
        slack_file_id: f.id,
        canal_id: canalId,
        message_ts: String(m.ts),
        nom: f.name ?? null,
        mimetype: f.mimetype ?? null,
        taille: f.size ?? 0,
        url_private: f.url_private_download ?? f.url_private ?? null,
      })),
  );
  if (fichiers.length) {
    await supabase.from("slack_fichiers").upsert(fichiers, { onConflict: "slack_file_id" });
  }
  return rows.length;
}

/** Un passage borné : au plus 1 appel soumis à limite + quelques fichiers. */
export async function runTick(supabase: any) {
  const job = await currentJob(supabase);
  if (!job) return { skipped: "aucune collecte" };
  if (job.statut !== "en_cours") return { skipped: `collecte ${job.statut}` };

  const meta: RobotMeta = job.fichiers_traites ?? {};
  const now = Date.now();
  if (meta.cooldown_until && Date.parse(meta.cooldown_until) > now) {
    return { skipped: "attente de la limite de débit" };
  }
  if (meta.lease_until && Date.parse(meta.lease_until) > now) {
    return { skipped: "un passage est déjà en cours" };
  }
  await patchMeta(supabase, job, { lease_until: new Date(now + 110_000).toISOString() });

  const rapport: Record<string, unknown> = {};
  try {
    // 1) PRIORITÉ ABSOLUE : les fichiers (perdus définitivement à la résiliation).
    if (!meta.files_indexed) {
      const idx = await indexerFichiers(supabase, job);
      rapport['index_fichiers'] = idx;
    }
    const dl = await telechargerLot(supabase);
    rapport['fichiers'] = dl;

    // 2) Un seul appel plafonné par passage : d'abord l'historique des canaux,
    //    puis les fils de discussion mis en file d'attente.
    for (let i = 0; i < RATE_LIMITED_CALLS_PER_TICK; i++) {
      const histo = await collecterHistorique(supabase, job);
      if ((histo as any).termine) {
        const threads = (job.fichiers_traites?.threads ?? []) as {
          c: string; ts: string; cur?: string | null;
        }[];
        if (threads.length) rapport['fil'] = await collecterFil(supabase, job, threads);
        else rapport['historique'] = histo;
      } else {
        rapport['historique'] = histo;
      }
    }

    await patchMeta(supabase, job, { derniere_erreur: null });
  } catch (e: any) {
    if (e instanceof RateLimited) {
      await patchMeta(supabase, job, {
        cooldown_until: new Date(Date.now() + e.retryAfter * 1000).toISOString(),
        derniere_erreur: `Limite Slack : reprise dans ${e.retryAfter}s`,
      });
      rapport['rate_limited'] = e.retryAfter;
    } else {
      await patchMeta(supabase, job, { derniere_erreur: String(e?.message ?? e).slice(0, 300) });
      rapport['erreur'] = String(e?.message ?? e);
    }
  } finally {
    await patchMeta(supabase, job, { lease_until: null });
  }
  return rapport;
}

async function indexerFichiers(supabase: any, job: any) {
  let cursor = (job.fichiers_traites?.files_cursor as string | null) ?? null;
  let n = 0;
  for (let page = 0; page < 3; page++) {
    const b = await slack("files.list", {
      limit: "100",
      ...(cursor ? { cursor } : { page: "1" }),
    });
    const files = b.files ?? [];
    const rows = files.map((f: any) => ({
      slack_file_id: f.id,
      message_ts: null,
      nom: f.name ?? f.title ?? null,
      mimetype: f.mimetype ?? null,
      taille: f.size ?? 0,
      url_private: f.url_private_download ?? f.url_private ?? null,
    }));
    if (rows.length) {
      await supabase.from("slack_fichiers").upsert(rows, { onConflict: "slack_file_id" });
      n += rows.length;
    }
    cursor = b.response_metadata?.next_cursor || null;
    await patchMeta(supabase, job, { files_cursor: cursor });
    if (!cursor) {
      await patchMeta(supabase, job, { files_indexed: true });
      break;
    }
  }
  return { recenses: n, termine: !!job.fichiers_traites?.files_indexed };
}

async function telechargerLot(supabase: any) {
  const { data: rows } = await supabase
    .from("slack_fichiers")
    .select("id")
    .is("storage_path", null)
    .is("erreur", null)
    .limit(FILES_PER_TICK);
  const ids = (rows ?? []).map((r: any) => r.id as string);
  if (!ids.length) return { ok: 0, echecs: 0 };
  const { downloadSlackFiles } = await import("@/server/slackArchive.server");
  return downloadSlackFiles(supabase, ids);
}

async function collecterHistorique(supabase: any, job: any) {
  const { data: canal } = await supabase
    .from("slack_canaux")
    .select("id, nom, slack_channel_id, collecte_cursor, collecte_messages")
    .eq("collecte_selection", true)
    .eq("collecte_terminee", false)
    .order("nom")
    .limit(1)
    .maybeSingle();
  if (!canal) {
    const threads = (job.fichiers_traites?.threads ?? []) as unknown[];
    const fichiersRestants = await resteFichiers(supabase);
    if (!threads.length && !fichiersRestants) {
      await patchJob(supabase, job.id, { statut: "termine" });
    }
    return { termine: true };
  }

  await patchMeta(supabase, job, { canal_courant: canal.nom, phase: "messages" });

  let b: any;
  try {
    b = await slack("conversations.history", {
      channel: canal.slack_channel_id,
      limit: String(PAGE_SIZE),
      ...(canal.collecte_cursor ? { cursor: canal.collecte_cursor } : {}),
    });
  } catch (e: any) {
    if (e instanceof RateLimited) throw e;
    // Un canal en échec (bot non invité, canal supprimé) n'arrête pas les autres.
    await supabase
      .from("slack_canaux")
      .update({ collecte_terminee: true, collecte_erreur: String(e?.message ?? e).slice(0, 300) })
      .eq("id", canal.id);
    return { canal: canal.nom, echec: String(e?.message ?? e) };
  }

  const messages = b.messages ?? [];
  const n = await enregistreMessages(supabase, canal.id, canal.slack_channel_id, messages);

  // Fils de discussion à récupérer plus tard, un appel à la fois.
  const threads = ((job.fichiers_traites?.threads ?? []) as { c: string; ts: string }[]).slice();
  for (const m of messages) {
    if (m.thread_ts && String(m.thread_ts) === String(m.ts) && (m.reply_count ?? 0) > 0) {
      if (threads.length < 5000) threads.push({ c: canal.slack_channel_id, ts: String(m.ts) });
    }
  }

  const cursor = b.response_metadata?.next_cursor || null;
  await supabase
    .from("slack_canaux")
    .update({
      collecte_cursor: cursor,
      collecte_terminee: !cursor,
      collecte_messages: (canal.collecte_messages ?? 0) + n,
      collecte_last_at: new Date().toISOString(),
      collecte_erreur: null,
    })
    .eq("id", canal.id);
  await patchMeta(supabase, job, { threads });

  return { canal: canal.nom, messages: n, reste: !!cursor };
}

async function collecterFil(
  supabase: any,
  job: any,
  threads: { c: string; ts: string; cur?: string | null }[],
) {
  const t = threads[0]!;
  const reste = threads.slice(1);
  let b: any;
  try {
    b = await slack("conversations.replies", {
      channel: t.c,
      ts: t.ts,
      limit: String(PAGE_SIZE),
      ...(t.cur ? { cursor: t.cur } : {}),
    });
  } catch (e: any) {
    if (e instanceof RateLimited) throw e;
    await patchMeta(supabase, job, { threads: reste, derniere_erreur: String(e?.message ?? e) });
    return { fil: t.ts, echec: String(e?.message ?? e) };
  }
  const canalId = await canalIdFor(supabase, t.c);
  const n = await enregistreMessages(supabase, canalId, t.c, b.messages ?? []);
  // Curseur du fil conservé en tête de file : reprise exacte au passage suivant.
  const next = b.response_metadata?.next_cursor || null;
  const nouvelles = next ? [{ ...t, cur: next }, ...reste] : reste;
  await patchMeta(supabase, job, { threads: nouvelles, phase: "fils" });
  return { fil: t.ts, messages: n, restants: nouvelles.length };
}


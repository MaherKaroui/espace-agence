// Lecture d'une archive d'export natif Slack (ZIP) côté navigateur.
// L'analyse et l'import se font par lots, fichier par fichier, pour supporter
// des archives volumineuses sans saturer la mémoire.
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";

export type SlackUser = {
  slack_user_id: string;
  nom: string | null;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  is_bot: boolean;
};

export type SlackChannelMeta = {
  slack_channel_id: string;
  nom: string;
  type: "public" | "private" | "dm" | "mpim";
  sujet: string | null;
  description: string | null;
  membres_count: number;
  slack_created_at: string | null;
  /** Dossier correspondant dans l'archive. */
  folder: string;
};

export type FileRef = {
  slack_file_id: string;
  slack_channel_id: string;
  message_ts: string;
  nom: string | null;
  mimetype: string | null;
  taille: number;
  url_private: string | null;
};

export type ArchiveSummary = {
  archiveNom: string;
  membres: SlackUser[];
  canaux: SlackChannelMeta[];
  dayFiles: string[];
  messagesCount: number;
  dateMin: string | null;
  dateMax: string | null;
  fichiersCount: number;
  fichiersTaille: number;
  /** Types de canaux présents dans l'archive. */
  contientPrives: boolean;
  contientDMs: boolean;
  ignores: string[];
};

const DAY_RE = /^(.*)\/(\d{4}-\d{2}-\d{2})\.json$/;

async function readJson(zip: JSZip, path: string): Promise<any | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  try {
    return JSON.parse(await entry.async("string"));
  } catch {
    return null;
  }
}

function mapUsers(raw: any[]): SlackUser[] {
  return (raw ?? []).map((u: any) => ({
    slack_user_id: u.id,
    nom: u.real_name ?? u.profile?.real_name ?? u.name ?? null,
    display_name: u.profile?.display_name || u.name || null,
    email: u.profile?.email ?? null,
    avatar_url: u.profile?.image_192 ?? u.profile?.image_72 ?? null,
    is_bot: !!(u.is_bot || u.id === "USLACKBOT"),
  }));
}

function mapChannels(raw: any[], type: SlackChannelMeta["type"]): SlackChannelMeta[] {
  return (raw ?? []).map((c: any) => {
    const nom: string =
      c.name ?? (type === "dm" ? `Message direct ${c.id}` : `Conversation ${c.id}`);
    return {
      slack_channel_id: c.id,
      nom,
      type,
      sujet: c.topic?.value || null,
      description: c.purpose?.value || null,
      membres_count: Array.isArray(c.members) ? c.members.length : 0,
      slack_created_at: c.created ? new Date(c.created * 1000).toISOString() : null,
      folder: c.name ?? c.id,
    };
  });
}

export function displayName(u: SlackUser | undefined, id: string | null | undefined) {
  return u?.nom || u?.display_name || (id ? `Membre ${id}` : "Inconnu");
}

/** Ouvre l'archive et produit le bilan complet, sans rien enregistrer. */
export async function analyseArchive(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<{ zip: JSZip; summary: ArchiveSummary }> {
  const zip = await JSZip.loadAsync(file);

  const membres = mapUsers((await readJson(zip, "users.json")) ?? []);
  const canaux: SlackChannelMeta[] = [
    ...mapChannels((await readJson(zip, "channels.json")) ?? [], "public"),
    ...mapChannels((await readJson(zip, "groups.json")) ?? [], "private"),
    ...mapChannels((await readJson(zip, "mpims.json")) ?? [], "mpim"),
    ...mapChannels((await readJson(zip, "dms.json")) ?? [], "dm"),
  ];
  const byFolder = new Map(canaux.map((c) => [c.folder, c]));

  const dayFiles: string[] = [];
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    if (DAY_RE.test(path)) dayFiles.push(path);
  });
  dayFiles.sort();

  let messagesCount = 0;
  let dateMin: string | null = null;
  let dateMax: string | null = null;
  const fileIds = new Map<string, number>();
  const ignores = new Set<string>();

  let done = 0;
  for (const path of dayFiles) {
    const m = path.match(DAY_RE)!;
    const folder = m[1]!;
    const day = m[2]!;
    if (!byFolder.has(folder)) {
      // Canal présent sous forme de dossier mais absent des métadonnées : on le crée quand même.
      const meta: SlackChannelMeta = {
        slack_channel_id: `folder:${folder}`,
        nom: folder,
        type: "public",
        sujet: null,
        description: null,
        membres_count: 0,
        slack_created_at: null,
        folder,
      };
      byFolder.set(folder, meta);
      canaux.push(meta);
      ignores.add(folder);
    }
    const arr = (await readJson(zip, path)) ?? [];
    if (Array.isArray(arr)) {
      messagesCount += arr.length;
      for (const msg of arr) {
        for (const f of msg.files ?? []) {
          if (f?.id && !fileIds.has(f.id)) fileIds.set(f.id, Number(f.size) || 0);
        }
      }
    }
    if (!dateMin || day < dateMin) dateMin = day;
    if (!dateMax || day > dateMax) dateMax = day;
    done++;
    if (onProgress && done % 20 === 0) onProgress(done, dayFiles.length);
  }
  onProgress?.(dayFiles.length, dayFiles.length);

  let fichiersTaille = 0;
  fileIds.forEach((v) => { fichiersTaille += v; });

  return {
    zip,
    summary: {
      archiveNom: file.name,
      membres,
      canaux,
      dayFiles,
      messagesCount,
      dateMin,
      dateMax,
      fichiersCount: fileIds.size,
      fichiersTaille,
      contientPrives: canaux.some((c) => c.type === "private"),
      contientDMs: canaux.some((c) => c.type === "dm" || c.type === "mpim"),
      ignores: [...ignores],
    },
  };
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export type ImportProgress = {
  phase: string;
  done: number;
  total: number;
  messages: number;
};

/**
 * Enregistre l'archive. Reprend là où l'import s'est arrêté grâce à la liste
 * des fichiers déjà traités, et ne crée jamais de doublon (clé canal + horodatage).
 */
export async function runImport(
  zip: JSZip,
  summary: ArchiveSummary,
  importId: string,
  dejaTraites: string[],
  onProgress: (p: ImportProgress) => void,
  shouldStop: () => boolean,
): Promise<{ messages: number; interrompu: boolean }> {
  const usersById = new Map(summary.membres.map((u) => [u.slack_user_id, u]));

  // 1. Membres
  onProgress({ phase: "Membres", done: 0, total: summary.membres.length, messages: 0 });
  for (const part of chunk(summary.membres, 200)) {
    const { error } = await supabase
      .from("slack_membres")
      .upsert(part as any, { onConflict: "slack_user_id" });
    if (error) throw error;
  }

  // 2. Canaux
  onProgress({ phase: "Canaux", done: 0, total: summary.canaux.length, messages: 0 });
  for (const part of chunk(summary.canaux, 200)) {
    const rows = part.map((c) => ({
      slack_channel_id: c.slack_channel_id,
      nom: c.nom,
      type: c.type,
      sujet: c.sujet,
      description: c.description,
      membres_count: c.membres_count,
      slack_created_at: c.slack_created_at,
    }));
    const { error } = await supabase
      .from("slack_canaux")
      .upsert(rows as any, { onConflict: "slack_channel_id" });
    if (error) throw error;
  }

  const { data: canauxRows } = await supabase.from("slack_canaux").select("id, slack_channel_id");
  const canalIdBySlack = new Map((canauxRows ?? []).map((c: any) => [c.slack_channel_id, c.id]));
  const idByFolder = new Map(
    summary.canaux
      .map((c) => [c.folder, canalIdBySlack.get(c.slack_channel_id)] as const)
      .filter(([, id]) => !!id) as [string, string][],
  );
  const slackIdByFolder = new Map(summary.canaux.map((c) => [c.folder, c.slack_channel_id]));

  // 3. Messages, jour par jour
  const restants = summary.dayFiles.filter((p) => !dejaTraites.includes(p));
  const traites = [...dejaTraites];
  let messages = 0;
  let done = 0;

  for (const path of restants) {
    if (shouldStop()) return { messages, interrompu: true };
    const m = path.match(DAY_RE)!;
    const folder = m[1]!;
    const canalId = idByFolder.get(folder);
    const slackChannelId = slackIdByFolder.get(folder);
    if (!canalId || !slackChannelId) { done++; continue; }

    const arr = (await readJson(zip, path)) ?? [];
    const rows: any[] = [];
    const fileRows: any[] = [];
    for (const msg of Array.isArray(arr) ? arr : []) {
      if (!msg?.ts) continue;
      const uid: string | null = msg.user ?? msg.bot_id ?? null;
      rows.push({
        canal_id: canalId,
        slack_channel_id: slackChannelId,
        ts: String(msg.ts),
        thread_ts: msg.thread_ts ? String(msg.thread_ts) : null,
        slack_user_id: uid,
        auteur:
          msg.user_profile?.real_name ||
          displayName(uid ? usersById.get(uid) : undefined, uid) ||
          msg.username ||
          null,
        texte: msg.text ?? "",
        reactions: msg.reactions ?? [],
        files: (msg.files ?? []).map((f: any) => ({
          id: f.id, name: f.name, size: f.size, mimetype: f.mimetype,
        })),
        posted_at: new Date(Number(msg.ts) * 1000).toISOString(),
      });
      for (const f of msg.files ?? []) {
        if (!f?.id) continue;
        fileRows.push({
          slack_file_id: f.id,
          canal_id: canalId,
          message_ts: String(msg.ts),
          nom: f.name ?? f.title ?? null,
          mimetype: f.mimetype ?? null,
          taille: Number(f.size) || 0,
          url_private: f.url_private_download ?? f.url_private ?? null,
        });
      }
    }

    for (const part of chunk(rows, 400)) {
      const { error } = await supabase
        .from("slack_messages")
        .upsert(part, { onConflict: "slack_channel_id,ts", ignoreDuplicates: true });
      if (error) throw error;
    }
    for (const part of chunk(fileRows, 200)) {
      const { error } = await supabase
        .from("slack_fichiers")
        .upsert(part, { onConflict: "slack_file_id", ignoreDuplicates: true });
      if (error) throw error;
    }

    messages += rows.length;
    traites.push(path);
    done++;

    // Point de reprise enregistré à chaque fichier traité.
    if (done % 5 === 0 || done === restants.length) {
      await supabase
        .from("slack_imports")
        .update({ fichiers_traites: traites })
        .eq("id", importId);
    }
    onProgress({ phase: "Messages", done, total: restants.length, messages });
  }

  await supabase
    .from("slack_imports")
    .update({ fichiers_traites: traites, statut: "termine" })
    .eq("id", importId);

  return { messages, interrompu: false };
}

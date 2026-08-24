// Intégration Slack en lecture seule pour alimenter le coffre-fort « Accès clients ».
// Le jeton du bot n'est JAMAIS écrit en dur : il provient du gestionnaire de secrets.
import { encryptConnectionKey } from "@/server/connectionKeyCrypto";

const SLACK_API = "https://slack.com/api";

function botToken(): string {
  const t = process.env['SLACK_BOT_TOKEN'];
  if (!t) throw new Error("SLACK_BOT_TOKEN n'est pas configuré dans les secrets du projet");
  return t;
}

async function slack(method: string, params: Record<string, string> = {}) {
  const url = `${SLACK_API}/${method}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken()}` } });
  if (!res.ok) throw new Error(`Slack ${method} : HTTP ${res.status}`);
  const body: any = await res.json();
  if (!body.ok) throw new Error(`Slack ${method} : ${body.error ?? "erreur inconnue"}`);
  return body;
}

export async function slackTest() {
  const body = await slack("auth.test");
  return { team: body.team as string, bot: body.user as string };
}

export type SlackChannel = { id: string; name: string; is_private: boolean; is_member: boolean };

export async function slackChannels(): Promise<SlackChannel[]> {
  const out: SlackChannel[] = [];
  let cursor = "";
  for (let i = 0; i < 10; i++) {
    const body = await slack("conversations.list", {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "200",
      ...(cursor ? { cursor } : {}),
    });
    for (const c of body.channels ?? []) {
      out.push({ id: c.id, name: c.name, is_private: !!c.is_private, is_member: !!c.is_member });
    }
    cursor = body.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export type Candidate = {
  channel_id: string;
  channel_name: string;
  message_ts: string;
  extrait: string;
  libelle: string;
  plateforme: string | null;
  url: string | null;
  identifiant: string | null;
  secret: string | null;
  client_id: string | null;
  client_nom: string | null;
  organisme: string | null;
  deja_present: boolean;
};

const ID_KEYS = /^(identifiant|login|utilisateur|user(name)?|email|mail|compte|id)\s*[:=]\s*(.+)$/i;
const PW_KEYS = /^(mot de passe|mdp|password|pass|pwd|code|secret|token|jeton)\s*[:=]\s*(.+)$/i;
const PLATFORM_KEYS = /^(plateforme|platform|site|url|lien|espace)\s*[:=]\s*(.+)$/i;

function normalize(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Analyse un message Slack et en extrait un accès potentiel, ou null. */
export function parseMessage(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^[\s*_>`-]+/, "").trim()).filter(Boolean);
  let identifiant: string | null = null;
  let secret: string | null = null;
  let plateforme: string | null = null;
  let url: string | null = null;

  for (const line of lines) {
    const clean = line.replace(/<([^|>]+)\|[^>]*>/g, "$1").replace(/[<>]/g, "");
    const pw = clean.match(PW_KEYS);
    if (pw && !secret) { secret = pw[3]!.trim(); continue; }
    const id = clean.match(ID_KEYS);
    if (id && !identifiant) { identifiant = id[3]!.trim(); continue; }
    const pf = clean.match(PLATFORM_KEYS);
    if (pf && !plateforme) {
      const v = pf[3]!.trim();
      if (/^https?:\/\//i.test(v)) url = v; else plateforme = v;
      continue;
    }
    if (!url) {
      const m = clean.match(/https?:\/\/\S+/);
      if (m) url = m[0]!;
    }
  }
  if (!identifiant && !secret) return null;
  const titre = lines[0] && !ID_KEYS.test(lines[0]) && !PW_KEYS.test(lines[0]) ? lines[0].slice(0, 80) : null;
  return { identifiant, secret, plateforme, url, titre };
}

/** Rapproche un canal / message d'un client existant. Propose, ne décide pas. */
function guessClient(
  haystack: string,
  clients: { id: string; label: string }[],
): { id: string; label: string } | null {
  const h = normalize(haystack);
  let best: { id: string; label: string } | null = null;
  let bestLen = 0;
  for (const c of clients) {
    const n = normalize(c.label).replace(/[^a-z0-9]+/g, " ").trim();
    if (n.length < 4) continue;
    const compact = n.replace(/\s+/g, "");
    if (h.includes(n) || normalize(haystack).replace(/[^a-z0-9]+/g, "").includes(compact)) {
      if (n.length > bestLen) { best = c; bestLen = n.length; }
    }
  }
  return best;
}

export async function slackScan(
  supabase: any,
  channels: { id: string; name: string }[],
  limitPerChannel = 200,
): Promise<Candidate[]> {
  const { data: clientRows } = await supabase
    .from("profiles")
    .select("id, prenom, nom, entreprise, email")
    .is("archived_at", null);
  const clients = (clientRows ?? []).map((c: any) => ({
    id: c.id as string,
    label: (c.entreprise || `${c.prenom ?? ""} ${c.nom ?? ""}`.trim() || c.email) as string,
  }));

  const { data: existing } = await supabase
    .from("client_acces")
    .select("slack_channel, slack_message_ts");
  const seen = new Set(
    (existing ?? [])
      .filter((r: any) => r.slack_channel && r.slack_message_ts)
      .map((r: any) => `${r.slack_channel}::${r.slack_message_ts}`),
  );

  const out: Candidate[] = [];
  for (const ch of channels) {
    let body: any;
    try {
      body = await slack("conversations.history", { channel: ch.id, limit: String(limitPerChannel) });
    } catch {
      continue; // canal inaccessible (bot non invité) : on l'ignore silencieusement
    }
    for (const msg of body.messages ?? []) {
      const text: string = msg.text ?? "";
      if (!text || msg.subtype) continue;
      const parsed = parseMessage(text);
      if (!parsed) continue;
      const guess = guessClient(`${ch.name} ${text}`, clients);
      out.push({
        channel_id: ch.id,
        channel_name: ch.name,
        message_ts: msg.ts,
        extrait: text.slice(0, 220),
        libelle: parsed.titre || parsed.plateforme || `Accès ${ch.name}`,
        plateforme: parsed.plateforme,
        url: parsed.url,
        identifiant: parsed.identifiant,
        secret: parsed.secret,
        client_id: guess?.id ?? null,
        client_nom: guess?.label ?? null,
        organisme: guess ? null : ch.name,
        deja_present: seen.has(`${ch.id}::${msg.ts}`),
      });
    }
  }
  return out;
}

export type ImportRow = {
  channel_id: string;
  channel_name: string;
  message_ts: string;
  libelle: string;
  plateforme: string | null;
  url: string | null;
  identifiant: string | null;
  secret: string | null;
  client_id: string | null;
  organisme: string | null;
};

export async function slackImport(supabase: any, userId: string, rows: ImportRow[]) {
  let created = 0;
  let updated = 0;
  let ignored = 0;

  for (const r of rows) {
    const { data: existing } = await supabase
      .from("client_acces")
      .select("id, manual_locked")
      .eq("slack_channel", r.channel_id)
      .eq("slack_message_ts", r.message_ts)
      .maybeSingle();

    // Un accès corrigé à la main n'est jamais écrasé par Slack.
    if (existing?.manual_locked) { ignored++; continue; }

    const payload: Record<string, unknown> = {
      client_id: r.client_id,
      organisme: r.organisme,
      libelle: r.libelle,
      plateforme: r.plateforme,
      url: r.url,
      identifiant: r.identifiant,
      secret_ciphertext: r.secret ? encryptConnectionKey(r.secret) : null,
      source: "slack",
      slack_channel: r.channel_id,
      slack_message_ts: r.message_ts,
      notes: `Importé du canal Slack #${r.channel_name}`,
      updated_by: userId,
    };

    if (existing) {
      const { error } = await supabase.from("client_acces").update(payload).eq("id", existing.id);
      if (error) throw error;
      updated++;
    } else {
      const { error } = await supabase
        .from("client_acces")
        .insert({ ...payload, created_by: userId });
      if (error) throw error;
      created++;
    }
  }

  try {
    await supabase.rpc("log_event", {
      _action: "acces_client_import_slack",
      _entity_type: "client_acces",
      _entity_id: null,
      _severity: "warning",
      _metadata: { created, updated, ignored },
    });
  } catch { /* journalisation non bloquante */ }

  return { created, updated, ignored };
}

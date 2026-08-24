// Traitements serveur sur les données Slack reprises dans IZISuivis :
// détection des accès dans les messages importés, et rapatriement des fichiers
// partagés TANT QUE l'abonnement Slack est actif.
import { parseMessage } from "@/server/slackAcces.server";

function normalize(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function guessClient(haystack: string, clients: { id: string; label: string }[]) {
  const h = normalize(haystack);
  const compactH = h.replace(/[^a-z0-9]+/g, "");
  let best: { id: string; label: string } | null = null;
  let bestLen = 0;
  for (const c of clients) {
    const n = normalize(c.label).replace(/[^a-z0-9]+/g, " ").trim();
    if (n.length < 4) continue;
    const compact = n.replace(/\s+/g, "");
    if (h.includes(n) || compactH.includes(compact)) {
      if (n.length > bestLen) { best = c; bestLen = n.length; }
    }
  }
  return best;
}

async function loadClients(supabase: any) {
  const { data } = await supabase
    .from("profiles")
    .select("id, prenom, nom, entreprise, email")
    .is("archived_at", null);
  return (data ?? []).map((c: any) => ({
    id: c.id as string,
    label: (c.entreprise || `${c.prenom ?? ""} ${c.nom ?? ""}`.trim() || c.email) as string,
  }));
}

/** Suggestions de rattachement canal → client, par similarité de nom. */
export async function suggestChannelClients(supabase: any) {
  const clients = await loadClients(supabase);
  const { data: canaux } = await supabase
    .from("slack_canaux")
    .select("id, slack_channel_id, nom, type, sujet, messages_count, client_id, rapprochement_valide")
    .order("nom");
  return (canaux ?? []).map((c: any) => {
    const guess = guessClient(`${c.nom} ${c.sujet ?? ""}`, clients);
    return {
      ...c,
      suggestion_id: guess?.id ?? null,
      suggestion_nom: guess?.label ?? null,
    };
  });
}

export type ArchiveCandidate = {
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

/** Détecte les accès dans les messages Slack déjà importés en base. */
export async function scanArchiveAcces(
  supabase: any,
  canalIds: string[] | null,
  limit = 4000,
): Promise<ArchiveCandidate[]> {
  const clients = await loadClients(supabase);

  const { data: existing } = await supabase
    .from("client_acces")
    .select("slack_channel, slack_message_ts");
  const seen = new Set(
    (existing ?? [])
      .filter((r: any) => r.slack_channel && r.slack_message_ts)
      .map((r: any) => `${r.slack_channel}::${r.slack_message_ts}`),
  );

  let q = supabase
    .from("slack_messages")
    .select("slack_channel_id, ts, texte, canal_id, slack_canaux!inner(nom, client_id)")
    .not("texte", "is", null)
    .order("posted_at", { ascending: false })
    .limit(limit);
  if (canalIds?.length) q = q.in("canal_id", canalIds);

  const { data, error } = await q;
  if (error) throw error;

  const out: ArchiveCandidate[] = [];
  for (const m of data ?? []) {
    const text: string = m.texte ?? "";
    if (!text) continue;
    const parsed = parseMessage(text);
    if (!parsed) continue;
    const canalNom = (m as any).slack_canaux?.nom ?? "";
    const rattache = (m as any).slack_canaux?.client_id ?? null;
    const guess = rattache
      ? clients.find((c: any) => c.id === rattache) ?? null
      : guessClient(`${canalNom} ${text}`, clients);
    out.push({
      channel_id: m.slack_channel_id,
      channel_name: canalNom,
      message_ts: m.ts,
      extrait: text.slice(0, 220),
      libelle: parsed.titre || parsed.plateforme || `Accès ${canalNom}`,
      plateforme: parsed.plateforme,
      url: parsed.url,
      identifiant: parsed.identifiant,
      secret: parsed.secret,
      client_id: guess?.id ?? null,
      client_nom: guess?.label ?? null,
      organisme: guess ? null : canalNom,
      deja_present: seen.has(`${m.slack_channel_id}::${m.ts}`),
    });
  }
  return out;
}

/**
 * Télécharge un lot de fichiers Slack et les dépose dans le stockage privé
 * d'IZISuivis. Nécessite un jeton Slack encore valide.
 */
export async function downloadSlackFiles(supabase: any, ids: string[]) {
  const token = process.env['SLACK_BOT_TOKEN'];
  if (!token) throw new Error("SLACK_BOT_TOKEN n'est pas configuré dans les secrets du projet");

  const { data: rows, error } = await supabase
    .from("slack_fichiers")
    .select("id, slack_file_id, nom, mimetype, url_private, storage_path")
    .in("id", ids);
  if (error) throw error;

  let ok = 0;
  let echecs = 0;
  for (const f of rows ?? []) {
    if (f.storage_path) { ok++; continue; }
    try {
      if (!f.url_private) throw new Error("aucune adresse de téléchargement dans l'export");
      const res = await fetch(f.url_private, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      if (type.includes("text/html")) throw new Error("réponse non autorisée (jeton ou portée insuffisante)");
      const buf = new Uint8Array(await res.arrayBuffer());
      const safe = (f.nom ?? "fichier").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
      const path = `${f.slack_file_id}/${safe}`;
      const up = await supabase.storage.from("slack-fichiers").upload(path, buf, {
        contentType: f.mimetype || "application/octet-stream",
        upsert: true,
      });
      if (up.error) throw up.error;
      await supabase
        .from("slack_fichiers")
        .update({ storage_path: path, downloaded_at: new Date().toISOString(), erreur: null })
        .eq("id", f.id);
      ok++;
    } catch (e: any) {
      await supabase
        .from("slack_fichiers")
        .update({ erreur: String(e?.message ?? e).slice(0, 300) })
        .eq("id", f.id);
      echecs++;
    }
  }
  return { ok, echecs };
}

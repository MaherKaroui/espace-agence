// Logique serveur du coffre-fort « Accès clients ».
// Les secrets ne transitent jamais en clair en base : on réutilise le
// mécanisme de chiffrement AES-256-GCM déjà présent dans le projet.
import { encryptConnectionKey, decryptConnectionKey } from "@/server/connectionKeyCrypto";

export type AccesRow = {
  id: string;
  client_id: string | null;
  dossier_id: string | null;
  organisme: string | null;
  libelle: string;
  plateforme: string | null;
  url: string | null;
  identifiant: string | null;
  notes: string | null;
  source: string;
  manual_locked: boolean;
  slack_channel: string | null;
  slack_message_ts: string | null;
  created_at: string;
  updated_at: string;
  has_secret: boolean;
  client_nom: string | null;
};

const SELECT_COLS =
  "id, client_id, dossier_id, organisme, libelle, plateforme, url, identifiant, notes, source, manual_locked, slack_channel, slack_message_ts, created_at, updated_at, secret_ciphertext, client:profiles!client_acces_client_id_fkey(prenom, nom, entreprise, email)";

function clientLabel(c: any): string | null {
  if (!c) return null;
  const nom = `${c.prenom ?? ""} ${c.nom ?? ""}`.trim();
  return c.entreprise || nom || c.email || null;
}

export async function assertStaff(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("is_staff", { _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible");
  if (!data) throw new Error("Réservé au personnel de l'agence");
}

export async function listAccesRows(supabase: any): Promise<AccesRow[]> {
  const { data, error } = await supabase
    .from("client_acces")
    .select(SELECT_COLS)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => {
    const { secret_ciphertext, client, ...rest } = r;
    return {
      ...rest,
      has_secret: !!secret_ciphertext,
      client_nom: clientLabel(client),
    } as AccesRow;
  });
}

export type AccesInput = {
  id?: string | null;
  client_id?: string | null;
  dossier_id?: string | null;
  organisme?: string | null;
  libelle: string;
  plateforme?: string | null;
  url?: string | null;
  identifiant?: string | null;
  secret?: string | null; // en clair, chiffré ici
  clear_secret?: boolean;
  notes?: string | null;
};

export async function saveAcces(supabase: any, userId: string, input: AccesInput) {
  const base: Record<string, unknown> = {
    client_id: input.client_id ?? null,
    dossier_id: input.dossier_id ?? null,
    organisme: input.organisme ?? null,
    libelle: input.libelle,
    plateforme: input.plateforme ?? null,
    url: input.url ?? null,
    identifiant: input.identifiant ?? null,
    notes: input.notes ?? null,
    updated_by: userId,
  };
  if (input.clear_secret) base['secret_ciphertext'] = null;
  else if (input.secret) base['secret_ciphertext'] = encryptConnectionKey(input.secret);

  if (input.id) {
    // Une correction manuelle verrouille la ligne : une synchronisation Slack
    // ultérieure ne l'écrasera plus jamais.
    const { error } = await supabase
      .from("client_acces")
      .update({ ...base, manual_locked: true })
      .eq("id", input.id);
    if (error) throw error;
    await logAcces(supabase, "acces_client_modifie", input.id, { libelle: input.libelle });
    return { id: input.id };
  }

  const { data, error } = await supabase
    .from("client_acces")
    .insert({ ...base, source: "manuel", manual_locked: true, created_by: userId })
    .select("id")
    .single();
  if (error) throw error;
  await logAcces(supabase, "acces_client_cree", data.id, { libelle: input.libelle });
  return { id: data.id as string };
}

export async function deleteAcces(supabase: any, id: string) {
  const { error } = await supabase.from("client_acces").delete().eq("id", id);
  if (error) throw error;
  await logAcces(supabase, "acces_client_supprime", id, {});
}

/** Déchiffre un secret et journalise systématiquement la consultation. */
export async function revealAcces(
  supabase: any,
  id: string,
  field: "identifiant" | "secret",
  mode: "affichage" | "copie",
) {
  const { data, error } = await supabase
    .from("client_acces")
    .select("id, libelle, plateforme, identifiant, secret_ciphertext, client_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Accès introuvable");

  await logAcces(supabase, "acces_client_consulte", id, {
    champ: field,
    mode,
    libelle: data.libelle,
    plateforme: data.plateforme,
  }, "warning");

  if (field === "identifiant") return { value: data.identifiant ?? "" };
  if (!data.secret_ciphertext) return { value: "" };
  try {
    return { value: decryptConnectionKey(data.secret_ciphertext) };
  } catch {
    throw new Error("Mot de passe illisible : il a été enregistré avec une autre clé de chiffrement. Ressaisissez-le.");
  }
}

async function logAcces(
  supabase: any,
  action: string,
  id: string,
  metadata: Record<string, unknown>,
  severity = "info",
) {
  try {
    await supabase.rpc("log_event", {
      _action: action,
      _entity_type: "client_acces",
      _entity_id: id,
      _severity: severity,
      _metadata: metadata,
    });
  } catch {
    // La journalisation ne doit jamais bloquer l'action métier.
  }
}

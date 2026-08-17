/**
 * Classement automatique des documents dans le Google Drive de l'agence
 * (compte unique connecté via le connecteur Lovable).
 * SERVER ONLY.
 */
import { ensureFolderPath, fileExistsInFolder, uploadFile } from "@/server/googleDrive.server";

/** Clé de connexion du Drive agence (connecteur lié au projet). */
export function agencyDriveKey(): string | null {
  return process.env['GOOGLE_DRIVE_API_KEY'] ?? null;
}

export async function fileDocumentToAgencyDrive(documentId: string) {
  const key = agencyDriveKey();
  if (!key) return { filed: false, reason: "drive_non_configure" as const };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: doc } = await supabaseAdmin
    .from("documents")
    .select("id, nom, storage_path, mime_type, dossier_id")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc?.storage_path) return { filed: false, reason: "aucun_fichier" as const };

  const { data: dossier } = await supabaseAdmin
    .from("dossiers")
    .select("id, titre, categorie, organisme_nom, client_id, created_at")
    .eq("id", doc.dossier_id)
    .maybeSingle();
  if (!dossier) return { filed: false, reason: "dossier_introuvable" as const };

  const { data: client } = await supabaseAdmin
    .from("profiles")
    .select("nom, prenom, entreprise, email")
    .eq("id", dossier.client_id)
    .maybeSingle();

  const clientName =
    `${client?.prenom ?? ""} ${client?.nom ?? ""}`.trim() ||
    client?.entreprise ||
    client?.email ||
    "Client";
  const ofName = dossier.organisme_nom || client?.entreprise || clientName;
  const dateStr = new Date(dossier.created_at).toISOString().slice(0, 10);

  const folderId = await ensureFolderPath(key, [
    "IZISuivis",
    "Clients",
    clientName,
    ofName,
    String(dossier.categorie).toUpperCase(),
    `${dateStr} - ${dossier.titre}`,
  ]);

  if (await fileExistsInFolder(key, doc.nom, folderId)) {
    return { filed: false, reason: "deja_present" as const };
  }

  const { data: blob, error: dlErr } = await supabaseAdmin.storage
    .from("documents")
    .download(doc.storage_path);
  if (dlErr || !blob) return { filed: false, reason: "telechargement_impossible" as const };

  await uploadFile(key, {
    name: doc.nom,
    folderId,
    mimeType: doc.mime_type || "application/octet-stream",
    data: await blob.arrayBuffer(),
  });

  return { filed: true as const };
}

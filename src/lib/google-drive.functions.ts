import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const CONNECTOR_ID = "google_drive";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/drive.file",
];

/** Statut de connexion Google Drive de l'utilisateur courant. */
export const getDriveStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getConnectionKeyForUser } = await import("@/server/appUserConnections.server");
    const key = await getConnectionKeyForUser(context.userId, CONNECTOR_ID);
    if (!key) return { connected: false, email: null as string | null };
    const { driveAccountEmail } = await import("@/server/googleDrive.server");
    return { connected: true, email: await driveAccountEmail(key) };
  });

/** Démarre le consentement OAuth Google Drive pour l'utilisateur courant. */
export const startDriveConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const clientKey = process.env['GOOGLE_DRIVE_APP_USER_CONNECTOR_CLIENT_API_KEY'];
    if (!clientKey) throw new Error("GOOGLE_DRIVE_APP_USER_CONNECTOR_CLIENT_API_KEY is not set");

    const request = getRequest();
    if (!request) throw new Error("OAuth must start from an app request.");
    const url = new URL(request.url);
    const sandboxHost = url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
    const returnUrl = new URL(
      "/oauth/google-drive/return",
      sandboxHost ? `https://${sandboxHost}` : url.origin,
    ).toString();

    const { getConnectionKeyForUser } = await import("@/server/appUserConnections.server");
    const existing = await getConnectionKeyForUser(context.userId, CONNECTOR_ID);

    const { authorizeAppUserOAuth } = await import("@/integrations/lovable/appUserConnector");
    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: CONNECTOR_ID,
      appUserId: context.userId,
      clientAPIKey: clientKey,
      returnUrl,
      connectionAPIKey: existing ?? undefined,
      credentialsConfiguration: { scopes: GOOGLE_SCOPES },
    });
    return { authorizationUrl };
  });

/** Termine la connexion : échange le code à usage unique et stocke la clé chiffrée. */
export const completeDriveConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string }) => {
    if (!input?.code || typeof input.code !== "string") throw new Error("Code manquant");
    return { code: input.code };
  })
  .handler(async ({ data, context }) => {
    const { exchangeAppUserOAuthCode } = await import("@/integrations/lovable/appUserConnector");
    const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(GATEWAY_BASE_URL, data.code);
    if (connectorId !== CONNECTOR_ID) throw new Error("Connecteur inattendu");
    const { saveConnectionKeyForUser } = await import("@/server/appUserConnections.server");
    await saveConnectionKeyForUser(context.userId, connectorId, connectionAPIKey);
    return { ok: true };
  });

/** Déconnecte Google Drive pour l'utilisateur courant. */
export const disconnectDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getConnectionKeyForUser, deleteConnectionForUser } = await import(
      "@/server/appUserConnections.server"
    );
    const key = await getConnectionKeyForUser(context.userId, CONNECTOR_ID);
    if (key) {
      const { disconnectAppUser } = await import("@/integrations/lovable/appUserConnector");
      try {
        await disconnectAppUser({
          gatewayBaseUrl: GATEWAY_BASE_URL,
          connectionAPIKey: key,
          connectorId: CONNECTOR_ID,
        });
      } catch {
        // La connexion distante peut déjà être révoquée : on nettoie quand même.
      }
    }
    await deleteConnectionForUser(context.userId, CONNECTOR_ID);
    return { ok: true };
  });

/**
 * Classe les documents d'un dossier dans le Drive de l'utilisateur :
 * Clients / NOM CLIENT / NOM OF / TYPE DE DEMANDE / AAAA-MM-JJ - Titre
 */
export const syncDossierToDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { dossierId: string }) => {
    if (!input?.dossierId || typeof input.dossierId !== "string") throw new Error("Dossier manquant");
    return { dossierId: input.dossierId };
  })
  .handler(async ({ data, context }) => {
    const { getConnectionKeyForUser } = await import("@/server/appUserConnections.server");
    const key = await getConnectionKeyForUser(context.userId, CONNECTOR_ID);
    if (!key) throw new Error("Google Drive n'est pas connecté pour votre compte.");

    // Vérifie que l'utilisateur a bien accès au dossier (RLS appliquée).
    const { data: dossier, error } = await context.supabase
      .from("dossiers")
      .select("id, titre, categorie, organisme_nom, client_id, created_at")
      .eq("id", data.dossierId)
      .maybeSingle();
    if (error) throw error;
    if (!dossier) throw new Error("Dossier introuvable ou accès refusé.");

    const { data: docs } = await context.supabase
      .from("documents")
      .select("id, nom, storage_path, mime_type")
      .eq("dossier_id", dossier.id)
      .not("storage_path", "is", null);

    if (!docs || docs.length === 0) return { uploaded: 0, skipped: 0 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: client } = await supabaseAdmin
      .from("profiles")
      .select("nom, prenom, entreprise, email")
      .eq("id", dossier.client_id)
      .maybeSingle();

    const clientName =
      `${client?.prenom ?? ""} ${client?.nom ?? ""}`.trim() || client?.entreprise || client?.email || "Client";
    const ofName = dossier.organisme_nom || client?.entreprise || clientName;
    const dateStr = new Date(dossier.created_at).toISOString().slice(0, 10);

    const { ensureFolderPath, fileExistsInFolder, uploadFile } = await import("@/server/googleDrive.server");
    const folderId = await ensureFolderPath(key, [
      "IZISuivis",
      "Clients",
      clientName,
      ofName,
      String(dossier.categorie).toUpperCase(),
      `${dateStr} - ${dossier.titre}`,
    ]);

    let uploaded = 0;
    let skipped = 0;
    for (const doc of docs) {
      if (!doc.storage_path) continue;
      if (await fileExistsInFolder(key, doc.nom, folderId)) {
        skipped++;
        continue;
      }
      const { data: blob, error: dlErr } = await supabaseAdmin.storage
        .from("documents")
        .download(doc.storage_path);
      if (dlErr || !blob) {
        skipped++;
        continue;
      }
      await uploadFile(key, {
        name: doc.nom,
        folderId,
        mimeType: doc.mime_type || "application/octet-stream",
        data: await blob.arrayBuffer(),
      });
      uploaded++;
    }

    return { uploaded, skipped };
  });

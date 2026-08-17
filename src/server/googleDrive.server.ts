import { callAsAppUser } from "@/integrations/lovable/appUserConnector";

export const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
export const DRIVE_CONNECTOR_ID = "google_drive";

const FOLDER_MIME = "application/vnd.google-apps.folder";

async function driveFetch(connectionAPIKey: string, path: string, init?: RequestInit) {
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey,
    connectorId: DRIVE_CONNECTOR_ID,
    path,
    init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Drive [${res.status}] : ${body}`);
  }
  return res;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Nettoie un nom de dossier / fichier Drive. */
export const cleanName = (s: string) =>
  (s || "")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Sans nom";

async function findFolder(connectionAPIKey: string, name: string, parentId: string) {
  const q = `name='${esc(name)}' and mimeType='${FOLDER_MIME}' and '${esc(parentId)}' in parents and trashed=false`;
  const res = await driveFetch(
    connectionAPIKey,
    `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
  );
  const json = (await res.json()) as { files?: { id: string }[] };
  return json.files?.[0]?.id ?? null;
}

async function createFolder(connectionAPIKey: string, name: string, parentId: string) {
  const res = await driveFetch(connectionAPIKey, `/drive/v3/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  const json = (await res.json()) as { id: string };
  return json.id;
}

/** Crée (si besoin) l'arborescence de dossiers et renvoie l'id du dernier. */
export async function ensureFolderPath(connectionAPIKey: string, segments: string[]) {
  let parent = "root";
  for (const raw of segments) {
    const name = cleanName(raw);
    const found = await findFolder(connectionAPIKey, name, parent);
    parent = found ?? (await createFolder(connectionAPIKey, name, parent));
  }
  return parent;
}

export async function fileExistsInFolder(connectionAPIKey: string, name: string, folderId: string) {
  const q = `name='${esc(cleanName(name))}' and '${esc(folderId)}' in parents and trashed=false`;
  const res = await driveFetch(
    connectionAPIKey,
    `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`,
  );
  const json = (await res.json()) as { files?: { id: string }[] };
  return Boolean(json.files?.length);
}

export async function uploadFile(
  connectionAPIKey: string,
  opts: { name: string; folderId: string; mimeType: string; data: ArrayBuffer },
) {
  const boundary = `izisuivis-${crypto.randomUUID()}`;
  const meta = JSON.stringify({ name: cleanName(opts.name), parents: [opts.folderId] });
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${opts.mimeType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + opts.data.byteLength + tail.length);
  body.set(head, 0);
  body.set(new Uint8Array(opts.data), head.length);
  body.set(tail, head.length + opts.data.byteLength);

  const res = await driveFetch(connectionAPIKey, `/upload/drive/v3/files?uploadType=multipart&fields=id,name`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await res.json()) as { id: string; name: string };
}

export async function driveAccountEmail(connectionAPIKey: string) {
  try {
    const res = await driveFetch(connectionAPIKey, `/drive/v3/about?fields=user(emailAddress,displayName)`);
    const json = (await res.json()) as { user?: { emailAddress?: string } };
    return json.user?.emailAddress ?? null;
  } catch {
    return null;
  }
}

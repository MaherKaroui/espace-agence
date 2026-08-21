import { supabase } from "@/integrations/supabase/client";

export type ConversationScope =
  | { kind: "client"; clientId: string }
  | { kind: "group"; conversationId: string }
  | { kind: "internal"; conversationId: string };

export type AttachmentKind = "image" | "video" | "audio" | "document";

export type ConversationFile = {
  messageId: string;
  path: string;
  name: string;
  mime: string | null;
  kind: AttachmentKind;
  createdAt: string;
  senderId: string;
  senderName: string;
};

export function scopeBucket(scope: ConversationScope): string {
  return scope.kind === "internal" ? "internal-chat-files" : "chat-files";
}

export function scopeKey(scope: ConversationScope): string {
  return scope.kind === "client" ? `client:${scope.clientId}` : `${scope.kind}:${scope.conversationId}`;
}

export function attachmentKind(name?: string | null, mime?: string | null): AttachmentKind {
  const n = (name ?? "").toLowerCase();
  if (mime?.startsWith("image/") || /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/.test(n)) return "image";
  if (mime?.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/.test(n)) {
    // Les vocaux enregistrés dans l'app sont en webm audio : on les traite comme audio.
    if (n.startsWith("vocal-") || mime?.startsWith("audio/")) return "audio";
    return "video";
  }
  if (mime?.startsWith("audio/") || n.startsWith("vocal-") || /\.(ogg|oga|mp3|m4a|wav|aac)$/.test(n)) return "audio";
  return "document";
}

export function isPdfAttachment(name?: string | null, mime?: string | null): boolean {
  return mime === "application/pdf" || (name ?? "").toLowerCase().endsWith(".pdf");
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["o", "Ko", "Mo", "Go"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Une seule requête de signature pour toute une page de résultats. */
export async function signPathsInBatch(
  bucket: string,
  paths: string[],
  expiresIn = 3600,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(paths));
  if (unique.length === 0) return map;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(unique, expiresIn);
  if (error) throw error;
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) map.set(row.path, row.signedUrl);
  }
  return map;
}

export async function fetchConversationFiles(
  scope: ConversationScope,
  opts: { limit: number; offset: number },
): Promise<ConversationFile[]> {
  const table = scope.kind === "client" ? "messages" : scope.kind === "group" ? "group_messages" : "internal_messages";

  let query = supabase
    .from(table as any)
    .select("id, sender_id, created_at, attachment_path, attachment_name, attachment_mime")
    .not("attachment_path", "is", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1);

  query = scope.kind === "client"
    ? query.eq("client_id", scope.clientId)
    : query.eq("conversation_id", scope.conversationId);

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const senderIds = Array.from(new Set(rows.map((r) => r.sender_id).filter(Boolean)));
  const names = new Map<string, string>();
  if (senderIds.length > 0) {
    const { data: profs } = await supabase.from("profiles").select("id, prenom, nom, email").in("id", senderIds);
    for (const p of (profs ?? []) as any[]) {
      names.set(p.id, `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || "Utilisateur");
    }
  }

  return rows.map((r) => ({
    messageId: r.id as string,
    path: r.attachment_path as string,
    name: (r.attachment_name as string) || (r.attachment_path as string).split("/").pop() || "fichier",
    mime: (r.attachment_mime as string) ?? null,
    kind: attachmentKind(r.attachment_name, r.attachment_mime),
    createdAt: r.created_at as string,
    senderId: r.sender_id as string,
    senderName: names.get(r.sender_id) ?? "Utilisateur",
  }));
}

/** Fait défiler la conversation jusqu'au message et le surligne brièvement. */
export function scrollToMessage(messageId: string) {
  const el = document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-2", "ring-primary", "rounded-2xl", "transition");
  window.setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2200);
  return true;
}

/** Téléchargement direct via une URL signée avec Content-Disposition. */
export async function downloadConversationFile(bucket: string, path: string, name?: string | null) {
  const filename = (name || path.split("/").pop() || "fichier").replace(/[\\/:*?"<>|]+/g, "_");
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600, { download: filename });
  if (error || !data?.signedUrl) throw error ?? new Error("Fichier introuvable");
  const a = document.createElement("a");
  a.href = data.signedUrl;
  a.download = filename;
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

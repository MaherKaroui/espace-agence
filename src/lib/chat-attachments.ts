import { supabase } from "@/integrations/supabase/client";

const getPathCandidates = (path: string) => {
  const candidates = [path];

  try {
    const decoded = decodeURIComponent(path);
    if (decoded !== path) candidates.push(decoded);
  } catch {
    // Keep the original path when it is not a valid encoded string.
  }

  const decodedParens = path
    .replace(/%28/gi, "(")
    .replace(/%29/gi, ")")
    .replace(/%20/gi, " ");
  if (decodedParens !== path) candidates.push(decodedParens);

  return [...new Set(candidates)];
};

const getSafeFilename = (name: string | null | undefined, path: string) => {
  const fallback = path.split("/").pop() || "fichier";
  return (name || fallback).replace(/[\\/:*?"<>|]+/g, "_");
};

export const createChatFileSignedUrl = async (path: string) => {
  let lastError: unknown = null;

  for (const candidate of getPathCandidates(path)) {
    const { data, error } = await supabase.storage
      .from("chat-files")
      .createSignedUrl(candidate, 3600);

    if (data?.signedUrl) return data.signedUrl;
    lastError = error;
  }

  throw lastError instanceof Error ? lastError : new Error("Fichier introuvable");
};

export const downloadChatFileAttachment = async (path: string, name?: string | null) => {
  const signedUrl = await createChatFileSignedUrl(path);
  const filename = getSafeFilename(name, path);

  try {
    const response = await fetch(signedUrl);
    if (!response.ok) throw new Error("Fichier introuvable");

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
  } catch (error) {
    if (error instanceof Error && error.message === "Fichier introuvable") {
      throw error;
    }

    const anchor = document.createElement("a");
    anchor.href = signedUrl;
    anchor.download = filename;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
};
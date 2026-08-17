import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Classe automatiquement un document fraîchement téléversé dans le Drive
 * de l'agence (compte unique). L'appelant doit avoir accès au document (RLS).
 */
export const autoFileDocumentToDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { documentId: string }) => {
    if (!input?.documentId || typeof input.documentId !== "string") {
      throw new Error("Document manquant");
    }
    return { documentId: input.documentId };
  })
  .handler(async ({ data, context }) => {
    // Contrôle d'accès : le document doit être visible par l'utilisateur.
    const { data: allowed, error } = await context.supabase
      .from("documents")
      .select("id")
      .eq("id", data.documentId)
      .maybeSingle();
    if (error) throw error;
    if (!allowed) throw new Error("Document introuvable ou accès refusé.");

    const { fileDocumentToAgencyDrive } = await import("@/server/driveAuto.server");
    return fileDocumentToAgencyDrive(data.documentId);
  });

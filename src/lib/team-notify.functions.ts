import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Given a dossierId, returns the list of emails to notify on the agency side:
 *  - all members of the dossier's pole (responsables + collaborateurs)
 *  - all users with role 'admin' or 'direction'
 *  - plus pole/dossier metadata for the email template.
 *
 * Authorization: the caller must either own the dossier (client) OR be staff.
 * Emails are only returned server-side; never leaked to unauthorized users.
 */
export const getTeamRecipientsForDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ dossierId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Load dossier (RLS as user) to authorize + get pole
    const { data: dossier } = await supabase
      .from("dossiers")
      .select("id, titre, categorie, statut, client_id, pole_id")
      .eq("id", data.dossierId)
      .maybeSingle();
    if (!dossier) return { emails: [], poleName: null, dossierTitre: null, categorie: null, statut: null };

    // Client name from profile
    const { data: clientProfile } = await supabase
      .from("profiles")
      .select("prenom, nom, email")
      .eq("id", dossier.client_id)
      .maybeSingle();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Pole info
    let poleName: string | null = null;
    let memberIds: string[] = [];
    if (dossier.pole_id) {
      const { data: pole } = await supabaseAdmin
        .from("poles")
        .select("nom")
        .eq("id", dossier.pole_id)
        .maybeSingle();
      poleName = pole?.nom ?? null;
      const { data: members } = await supabaseAdmin
        .from("pole_members")
        .select("user_id")
        .eq("pole_id", dossier.pole_id);
      memberIds = (members ?? []).map((m: any) => m.user_id);
    }

    // Admins + direction always notified
    const { data: adminRoles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "direction"] as any);
    const adminIds = (adminRoles ?? []).map((r: any) => r.user_id);

    const allIds = Array.from(new Set([...memberIds, ...adminIds])).filter((id) => id && id !== dossier.client_id);
    if (allIds.length === 0) return { emails: [], poleName, dossierTitre: dossier.titre, categorie: dossier.categorie, statut: dossier.statut, clientName: null, clientEmail: null };

    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .in("id", allIds);
    const emails = Array.from(new Set((profs ?? []).map((p: any) => p.email).filter(Boolean))) as string[];

    const clientName = `${clientProfile?.prenom ?? ""} ${clientProfile?.nom ?? ""}`.trim() || clientProfile?.email || "Client";

    return {
      emails,
      poleName,
      dossierTitre: dossier.titre,
      categorie: dossier.categorie,
      statut: dossier.statut,
      clientName,
      clientEmail: clientProfile?.email ?? null,
    };
  });

/**
 * For a given clientId, returns the staff emails (admins + direction + members
 * of any pole this client has a dossier in). Used when a client replies in the
 * messagerie (no specific dossier in scope).
 */
export const getTeamRecipientsForClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ clientId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Load client profile (RLS)
    const { data: clientProfile } = await supabase
      .from("profiles")
      .select("prenom, nom, email")
      .eq("id", data.clientId)
      .maybeSingle();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Poles from client dossiers
    const { data: dossiers } = await supabaseAdmin
      .from("dossiers")
      .select("pole_id")
      .eq("client_id", data.clientId);
    const poleIds = Array.from(new Set((dossiers ?? []).map((d: any) => d.pole_id).filter(Boolean)));

    let memberIds: string[] = [];
    if (poleIds.length > 0) {
      const { data: members } = await supabaseAdmin
        .from("pole_members")
        .select("user_id")
        .in("pole_id", poleIds);
      memberIds = (members ?? []).map((m: any) => m.user_id);
    }

    const { data: adminRoles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "direction"] as any);
    const adminIds = (adminRoles ?? []).map((r: any) => r.user_id);

    const allIds = Array.from(new Set([...memberIds, ...adminIds])).filter((id) => id && id !== data.clientId && id !== userId);
    if (allIds.length === 0) return { emails: [], clientName: null };

    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .in("id", allIds);
    const emails = Array.from(new Set((profs ?? []).map((p: any) => p.email).filter(Boolean))) as string[];

    const clientName = `${clientProfile?.prenom ?? ""} ${clientProfile?.nom ?? ""}`.trim() || clientProfile?.email || "Client";
    return { emails, clientName };
  });

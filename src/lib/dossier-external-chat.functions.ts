import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Ouvre (ou crée) la conversation "external" liée à un dossier pour
 * discuter avec les auditeurs / certificateurs affectés.
 * - Staff du pôle du dossier + admin/direction : autorisés.
 * - Auditeurs / certificateurs affectés au dossier : autorisés.
 * Seed automatique des membres à chaque appel (idempotent).
 */
export const openDossierExternalConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { dossierId: string }) =>
    z.object({ dossierId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Vérifier accès (staff périmètre, admin/direction, ou affecté)
    const { data: allowed } = await supabase.rpc("qualiopi_dossier_participant" as any, {
      _user: userId,
      _dossier: data.dossierId,
    });
    if (!allowed) throw new Error("Accès refusé à ce dossier");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Récupérer le dossier
    const { data: d } = await supabaseAdmin
      .from("dossiers")
      .select("id, titre, pole_id")
      .eq("id", data.dossierId)
      .maybeSingle();
    if (!d) throw new Error("Dossier introuvable");

    const titre = `Audit · ${d.titre}`;

    // Chercher conv existante
    const { data: existing } = await supabaseAdmin
      .from("internal_conversations")
      .select("id")
      .eq("type", "external" as any)
      .eq("dossier_id", data.dossierId)
      .maybeSingle();

    let conversationId: string;
    if (existing) {
      conversationId = existing.id;
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("internal_conversations")
        .insert({
          type: "external" as any,
          titre,
          is_group: true,
          created_by: userId,
          dossier_id: data.dossierId,
          pole_id: d.pole_id,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      conversationId = created.id;
    }

    // Composer les membres à seeder
    const memberIds = new Set<string>([userId]);

    // Admin + Direction
    const { data: privileged } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "direction"] as any);
    (privileged ?? []).forEach((r: any) => memberIds.add(r.user_id));

    // Membres du pôle
    if (d.pole_id) {
      const { data: pm } = await supabaseAdmin
        .from("pole_members")
        .select("user_id")
        .eq("pole_id", d.pole_id);
      (pm ?? []).forEach((r: any) => memberIds.add(r.user_id));
    }

    // Intervenants externes affectés (actifs)
    const { data: assign } = await supabaseAdmin
      .from("dossier_assignments")
      .select("user_id")
      .eq("dossier_id", data.dossierId)
      .eq("active", true);
    (assign ?? []).forEach((r: any) => memberIds.add(r.user_id));

    const rows = Array.from(memberIds).map((uid) => ({
      conversation_id: conversationId,
      user_id: uid,
      role: uid === userId ? "owner" : "member",
    }));
    if (rows.length > 0) {
      await supabaseAdmin
        .from("internal_conversation_members")
        .upsert(rows, { onConflict: "conversation_id,user_id", ignoreDuplicates: true });
    }

    return { id: conversationId };
  });

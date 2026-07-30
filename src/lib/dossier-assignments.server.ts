/**
 * Synchronise l'appartenance d'un intervenant externe au canal d'audit
 * (conversation interne de type "external") lié au dossier.
 */
export async function syncExternalConversationMember(
  dossierId: string,
  userId: string,
  add: boolean,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: conv } = await supabaseAdmin
    .from("internal_conversations")
    .select("id")
    .eq("type", "external" as any)
    .eq("dossier_id", dossierId)
    .maybeSingle();

  let conversationId = conv?.id as string | undefined;

  if (!conversationId) {
    if (!add) return;
    // Crée le canal d'audit s'il n'existe pas encore
    const { data: d } = await supabaseAdmin
      .from("dossiers")
      .select("id, titre, pole_id")
      .eq("id", dossierId)
      .maybeSingle();
    if (!d) return;
    const { data: created } = await supabaseAdmin
      .from("internal_conversations")
      .insert({
        type: "external" as any,
        titre: `Audit · ${d.titre}`,
        is_group: true,
        created_by: userId,
        dossier_id: dossierId,
        pole_id: d.pole_id,
      })
      .select("id")
      .single();
    conversationId = created?.id;
    if (!conversationId) return;

    // Seed agence : admin/direction + membres du pôle
    const ids = new Set<string>();
    const { data: privileged } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "direction"] as any);
    (privileged ?? []).forEach((r: any) => ids.add(r.user_id));
    if (d.pole_id) {
      const { data: pm } = await supabaseAdmin
        .from("pole_members")
        .select("user_id")
        .eq("pole_id", d.pole_id);
      (pm ?? []).forEach((r: any) => ids.add(r.user_id));
    }
    if (ids.size > 0) {
      await supabaseAdmin.from("internal_conversation_members").upsert(
        Array.from(ids).map((uid) => ({
          conversation_id: conversationId!,
          user_id: uid,
          role: "member",
        })),
        { onConflict: "conversation_id,user_id", ignoreDuplicates: true },
      );
    }
  }

  if (add) {
    await supabaseAdmin
      .from("internal_conversation_members")
      .upsert(
        [{ conversation_id: conversationId, user_id: userId, role: "member" }],
        { onConflict: "conversation_id,user_id", ignoreDuplicates: true },
      );
  } else {
    await supabaseAdmin
      .from("internal_conversation_members")
      .delete()
      .eq("conversation_id", conversationId)
      .eq("user_id", userId);
  }
}

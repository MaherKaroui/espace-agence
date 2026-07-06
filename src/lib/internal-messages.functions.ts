import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function ensureAgencyMember(supabase: any, callerId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", callerId);
  const isAgency = !!roles?.some((r: any) =>
    ["admin", "direction", "manager", "consultant"].includes(r.role),
  );
  if (!isAgency) throw new Error("Réservé aux membres de l'agence");
  return {
    isAdmin: !!roles?.some((r: any) => r.role === "admin"),
    isDirection: !!roles?.some((r: any) => r.role === "direction"),
  };
}

/**
 * Liste les contacts internes autorisés pour le caller (membres de ses pôles,
 * responsables de ses pôles, admin/direction).
 */
export const listAllowedInternalContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId: callerId } = context;
    await ensureAgencyMember(supabase, callerId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Tous les admin/direction
    const { data: privileged } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["admin", "direction"]);

    // 2) Membres des mêmes pôles actifs
    const { data: myPoles } = await supabaseAdmin
      .from("pole_members")
      .select("pole_id, poles!inner(actif)")
      .eq("user_id", callerId)
      .eq("poles.actif", true);
    const poleIds = (myPoles ?? []).map((r: any) => r.pole_id);

    let sameScope: { user_id: string }[] = [];
    if (poleIds.length > 0) {
      const { data } = await supabaseAdmin
        .from("pole_members")
        .select("user_id")
        .in("pole_id", poleIds);
      sameScope = data ?? [];
    }

    const ids = new Set<string>();
    (privileged ?? []).forEach((r: any) => ids.add(r.user_id));
    sameScope.forEach((r) => ids.add(r.user_id));
    ids.delete(callerId);

    if (ids.size === 0) return [];

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, prenom, nom, email")
      .in("id", Array.from(ids));

    const { data: rolesRows } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", Array.from(ids));

    const rolesByUser = new Map<string, string[]>();
    (rolesRows ?? []).forEach((r: any) => {
      const cur = rolesByUser.get(r.user_id) ?? [];
      cur.push(r.role);
      rolesByUser.set(r.user_id, cur);
    });

    return (profiles ?? []).map((p: any) => ({
      id: p.id,
      prenom: p.prenom,
      nom: p.nom,
      email: p.email,
      roles: rolesByUser.get(p.id) ?? [],
    }));
  });

/**
 * Crée une nouvelle conversation interne avec les membres donnés (au moins 1).
 * Vérifie que chaque membre est un contact autorisé.
 */
export const createInternalConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        titre: z.string().trim().max(200).optional(),
        memberIds: z.array(z.string().uuid()).min(1).max(50),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    await ensureAgencyMember(supabase, callerId);

    // Vérifier chaque contact autorisé via la fonction SQL can_internal_contact
    for (const memberId of data.memberIds) {
      if (memberId === callerId) continue;
      const { data: allowed, error } = await supabase.rpc("can_internal_contact", {
        _a: callerId,
        _b: memberId,
      });
      if (error) throw new Error(error.message);
      if (!allowed) throw new Error("Un des contacts n'est pas dans votre périmètre");
    }

    const isGroup = data.memberIds.filter((m) => m !== callerId).length > 1;
    const { data: conv, error: cErr } = await supabase
      .from("internal_conversations")
      .insert({ titre: data.titre ?? null, is_group: isGroup, created_by: callerId })
      .select()
      .single();
    if (cErr) throw new Error(cErr.message);

    // Ajout du créateur en owner
    const { error: mErr } = await supabase
      .from("internal_conversation_members")
      .insert({ conversation_id: conv.id, user_id: callerId, role: "owner" });
    if (mErr) throw new Error(mErr.message);

    // Ajout des autres membres
    const others = data.memberIds.filter((m) => m !== callerId);
    if (others.length > 0) {
      const rows = others.map((uid) => ({ conversation_id: conv.id, user_id: uid, role: "member" }));
      const { error: mmErr } = await supabase.from("internal_conversation_members").insert(rows);
      if (mmErr) throw new Error(mmErr.message);
    }

    return { id: conv.id };
  });

export const markInternalConversationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ conversationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("internal_conversation_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", data.conversationId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

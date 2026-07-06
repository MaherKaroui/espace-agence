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

// -------- Conversations liées à un pôle / client / dossier / tâche --------

const ContextTypeEnum = z.enum(["pole", "client", "dossier", "task"]);

async function seedMembersForConversation(
  admin: any,
  conversationId: string,
  ownerId: string,
  members: { userId: string; role: "owner" | "member" }[],
) {
  // De-dupe, force ownerId to owner
  const uniq = new Map<string, "owner" | "member">();
  for (const m of members) uniq.set(m.userId, m.role);
  uniq.set(ownerId, "owner");
  const rows = Array.from(uniq.entries()).map(([user_id, role]) => ({
    conversation_id: conversationId,
    user_id,
    role,
  }));
  if (rows.length === 0) return;
  const { error } = await admin
    .from("internal_conversation_members")
    .upsert(rows, { onConflict: "conversation_id,user_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

async function fetchAdminDirectionIds(admin: any): Promise<string[]> {
  const { data } = await admin.from("user_roles").select("user_id, role").in("role", ["admin", "direction"]);
  return Array.from(new Set(((data ?? []) as any[]).map((r) => r.user_id)));
}

/**
 * Ouvre (ou crée) la conversation interne liée à une entité (pôle, client, dossier ou tâche).
 * Vérifie que l'appelant a le droit d'y accéder (admin, direction, ou pôle concerné).
 * Ré-injecte automatiquement les admin/direction et les membres du pôle concerné.
 */
export const openContextConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        type: ContextTypeEnum,
        entityId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    await ensureAgencyMember(supabase, callerId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Résoudre l'entité + le pôle concerné + le titre
    let poleId: string | null = null;
    let clientId: string | null = null;
    let dossierId: string | null = null;
    let taskId: string | null = null;
    let titre = "";

    if (data.type === "pole") {
      const { data: pole } = await supabaseAdmin
        .from("poles")
        .select("id, nom, actif")
        .eq("id", data.entityId)
        .maybeSingle();
      if (!pole) throw new Error("Pôle introuvable");
      if (!pole.actif) throw new Error("Ce pôle est désactivé");
      poleId = pole.id;
      titre = `Pôle · ${pole.nom}`;
    } else if (data.type === "client") {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id, prenom, nom, email")
        .eq("id", data.entityId)
        .maybeSingle();
      if (!profile) throw new Error("Client introuvable");
      clientId = profile.id;
      titre = `Client · ${`${profile.prenom ?? ""} ${profile.nom ?? ""}`.trim() || profile.email}`;
      // Récupérer un pôle représentatif pour seed les membres
      const { data: dossiers } = await supabaseAdmin
        .from("dossiers")
        .select("pole_id")
        .eq("client_id", clientId);
      const poleIds = Array.from(
        new Set(((dossiers ?? []) as any[]).map((d) => d.pole_id).filter(Boolean)),
      ) as string[];
      poleId = poleIds[0] ?? null;
      // On mémorise tous les pôles côté seed
      (data as any)._poleIds = poleIds;
    } else if (data.type === "dossier") {
      const { data: d } = await supabaseAdmin
        .from("dossiers")
        .select("id, titre, pole_id, client_id")
        .eq("id", data.entityId)
        .maybeSingle();
      if (!d) throw new Error("Dossier introuvable");
      dossierId = d.id;
      clientId = d.client_id;
      poleId = d.pole_id;
      titre = `Dossier · ${d.titre}`;
    } else if (data.type === "task") {
      const { data: t } = await supabaseAdmin
        .from("agency_tasks")
        .select("id, title, pole_id, assigned_to, created_by, dossier_id, client_id")
        .eq("id", data.entityId)
        .maybeSingle();
      if (!t) throw new Error("Tâche introuvable");
      taskId = t.id;
      poleId = t.pole_id;
      dossierId = t.dossier_id;
      clientId = t.client_id;
      titre = `Tâche · ${t.title}`;
      (data as any)._assignedTo = t.assigned_to;
      (data as any)._createdBy = t.created_by;
    }

    // Vérifier le périmètre de l'appelant
    const { data: rolesRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    const rolesArr = ((rolesRow ?? []) as any[]).map((r) => r.role);
    const isPrivileged = rolesArr.includes("admin") || rolesArr.includes("direction");
    if (!isPrivileged) {
      if (poleId) {
        const { data: pm } = await supabase
          .from("pole_members")
          .select("user_id")
          .eq("pole_id", poleId)
          .eq("user_id", callerId)
          .maybeSingle();
        if (!pm) throw new Error("Vous n'avez pas accès à cette conversation");
      } else if (data.type === "client") {
        // client sans dossier -> réservé à admin/direction
        throw new Error("Ce client n'est rattaché à aucun de vos pôles");
      }
    }

    // Recherche d'une conversation existante
    const filter: Record<string, string | null> = {
      type: data.type,
      pole_id: poleId,
      client_id: clientId,
      dossier_id: dossierId,
      task_id: taskId,
    };
    const targetCol =
      data.type === "pole"
        ? "pole_id"
        : data.type === "client"
        ? "client_id"
        : data.type === "dossier"
        ? "dossier_id"
        : "task_id";

    const existing = await supabaseAdmin
      .from("internal_conversations")
      .select("id")
      .eq("type", data.type)
      .eq(targetCol, filter[targetCol] as string)
      .maybeSingle();

    let conversationId: string;
    if (existing.data) {
      conversationId = existing.data.id;
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("internal_conversations")
        .insert({
          type: data.type,
          titre,
          is_group: true,
          created_by: callerId,
          pole_id: poleId,
          client_id: clientId,
          dossier_id: dossierId,
          task_id: taskId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      conversationId = created.id;
    }

    // Composition des membres à seeder :
    // - admin + direction (toujours)
    // - membres du/des pôle(s) concerné(s)
    // - créateur / assigné pour une tâche
    const adminIds = await fetchAdminDirectionIds(supabaseAdmin);
    let poleMemberIds: string[] = [];
    const poleIdsToSeed: string[] = poleId
      ? [poleId]
      : Array.isArray((data as any)._poleIds)
      ? ((data as any)._poleIds as string[])
      : [];
    if (poleIdsToSeed.length > 0) {
      const { data: pm } = await supabaseAdmin
        .from("pole_members")
        .select("user_id")
        .in("pole_id", poleIdsToSeed);
      poleMemberIds = Array.from(new Set(((pm ?? []) as any[]).map((r) => r.user_id)));
    }

    const extra: string[] = [];
    if (data.type === "task") {
      if ((data as any)._assignedTo) extra.push((data as any)._assignedTo);
      if ((data as any)._createdBy) extra.push((data as any)._createdBy);
    }

    const memberList = [
      ...adminIds.map((uid) => ({ userId: uid, role: "member" as const })),
      ...poleMemberIds.map((uid) => ({ userId: uid, role: "member" as const })),
      ...extra.map((uid) => ({ userId: uid, role: "member" as const })),
      { userId: callerId, role: "member" as const },
    ];
    await seedMembersForConversation(supabaseAdmin, conversationId, callerId, memberList);

    return { id: conversationId };
  });

/**
 * Bascule "favori" pour la conversation courante et l'utilisateur courant.
 */
export const setInternalConversationFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        conversationId: z.string().uuid(),
        favorite: z.boolean().optional(),
        muted: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: Record<string, boolean> = {};
    if (typeof data.favorite === "boolean") patch.favorite = data.favorite;
    if (typeof data.muted === "boolean") patch.muted = data.muted;
    if (Object.keys(patch).length === 0) return { ok: true };

    // Si l'utilisateur n'est pas encore explicitement membre (canal de pôle),
    // on l'ajoute pour pouvoir stocker ses préférences.
    const { data: existing } = await supabase
      .from("internal_conversation_members")
      .select("user_id")
      .eq("conversation_id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!existing) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: canView } = await supabaseAdmin.rpc("can_view_internal_conv", {
        _user: userId,
        _conv: data.conversationId,
      });
      if (!canView) throw new Error("Accès refusé");
      const { error: insErr } = await supabaseAdmin
        .from("internal_conversation_members")
        .insert({ conversation_id: data.conversationId, user_id: userId, role: "member", ...patch });
      if (insErr) throw new Error(insErr.message);
      return { ok: true };
    }

    const { error } = await supabase
      .from("internal_conversation_members")
      .update(patch)
      .eq("conversation_id", data.conversationId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Archive / désarchive une conversation (admin/direction ou propriétaire uniquement).
 */
export const setInternalConversationArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ conversationId: z.string().uuid(), archived: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("internal_conversations")
      .update({ archived_at: data.archived ? new Date().toISOString() : null })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


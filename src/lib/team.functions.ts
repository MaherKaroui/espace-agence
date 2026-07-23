import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const STAFF_ROLES = ["admin", "direction", "manager", "consultant"] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

async function assertAdmin(supabase: any, callerId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", callerId);
  const isAdmin = !!roles?.some((r: any) => r.role === "admin");
  if (!isAdmin) throw new Error("Réservé aux administrateurs");
}

async function assertAdminOrDirection(supabase: any, callerId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", callerId);
  const ok = !!roles?.some((r: any) => r.role === "admin" || r.role === "direction");
  if (!ok) throw new Error("Réservé à la direction / administration");
}

export type TeamMember = {
  id: string;
  email: string;
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
  entreprise: string | null;
  archived_at: string | null;
  archive_reason: string | null;
  created_at: string;
  roles: string[];
  poles: { id: string; nom: string; code: string; role: string }[];
  last_activity: string | null;
  active_sessions: number;
  push_subscriptions_count: number;
  browser_notifications_active: boolean;
};

export type NotificationRecipientHistoryRow = {
  id: string;
  user_id: string;
  type: string;
  titre: string;
  message: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
  recipient_email: string | null;
  recipient_name: string | null;
};

/** Liste tous les membres de l'équipe (staff) — Direction/Admin uniquement */
export const listTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TeamMember[]> => {
    const { supabase, userId } = context;
    await assertAdminOrDirection(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Toutes les liaisons rôles staff
    const { data: staffRoles, error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("role", [...STAFF_ROLES]);
    if (rolesErr) throw new Error(rolesErr.message);

    const staffIds = [...new Set((staffRoles ?? []).map((r) => r.user_id))];
    if (staffIds.length === 0) return [];

    const rolesByUser = new Map<string, string[]>();
    for (const r of staffRoles ?? []) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    }

    // 2) Profils
    const { data: profiles, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, prenom, nom, telephone, entreprise, archived_at, archive_reason, created_at")
      .in("id", staffIds);
    if (profErr) throw new Error(profErr.message);

    // 3) Pôles (memberships + info pôle)
    const { data: memberships, error: memErr } = await supabaseAdmin
      .from("pole_members")
      .select("user_id, pole_id, role, poles:pole_id(id, nom, code)")
      .in("user_id", staffIds);
    if (memErr) throw new Error(memErr.message);

    const polesByUser = new Map<string, TeamMember["poles"]>();
    for (const m of memberships ?? []) {
      const p = (m as any).poles;
      if (!p) continue;
      const arr = polesByUser.get(m.user_id) ?? [];
      arr.push({ id: p.id, nom: p.nom, code: p.code, role: (m as any).role ?? "member" });
      polesByUser.set(m.user_id, arr);
    }

    // 4) Sessions : dernière activité + sessions actives
    const { data: sessions, error: sessErr } = await supabaseAdmin
      .from("user_sessions")
      .select("user_id, started_at, last_seen_at, ended_at")
      .in("user_id", staffIds);
    if (sessErr) throw new Error(sessErr.message);

    const lastByUser = new Map<string, string>();
    const activeByUser = new Map<string, number>();
    const now = Date.now();
    for (const s of sessions ?? []) {
      const ref = s.last_seen_at ?? s.ended_at ?? s.started_at;
      const prev = lastByUser.get(s.user_id);
      if (!prev || (ref && new Date(ref).getTime() > new Date(prev).getTime())) {
        if (ref) lastByUser.set(s.user_id, ref);
      }
      if (!s.ended_at) {
        const lastSeen = s.last_seen_at ?? s.started_at;
        if (lastSeen && now - new Date(lastSeen).getTime() < 5 * 60 * 1000) {
          activeByUser.set(s.user_id, (activeByUser.get(s.user_id) ?? 0) + 1);
        }
      }
    }

    // 5) Notifications navigateur : au moins un abonnement actif par utilisateur
    const { data: pushSubs, error: pushErr } = await supabaseAdmin
      .from("push_subscriptions")
      .select("user_id")
      .in("user_id", staffIds);
    if (pushErr) throw new Error(pushErr.message);

    const pushByUser = new Map<string, number>();
    for (const sub of pushSubs ?? []) {
      pushByUser.set(sub.user_id, (pushByUser.get(sub.user_id) ?? 0) + 1);
    }

    return (profiles ?? []).map((p) => ({
      id: p.id,
      email: p.email,
      prenom: p.prenom,
      nom: p.nom,
      telephone: p.telephone,
      entreprise: p.entreprise,
      archived_at: p.archived_at,
      archive_reason: p.archive_reason,
      created_at: p.created_at,
      roles: rolesByUser.get(p.id) ?? [],
      poles: polesByUser.get(p.id) ?? [],
      last_activity: lastByUser.get(p.id) ?? null,
      active_sessions: activeByUser.get(p.id) ?? 0,
      push_subscriptions_count: pushByUser.get(p.id) ?? 0,
      browser_notifications_active: (pushByUser.get(p.id) ?? 0) > 0,
    }));
  });

/** Historique des notifications internes avec destinataires — Direction/Admin uniquement */
export const listNotificationRecipientHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NotificationRecipientHistoryRow[]> => {
    const { supabase, userId } = context;
    await assertAdminOrDirection(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: notifications, error } = await supabaseAdmin
      .from("notifications")
      .select("id, user_id, type, titre, message, link, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((notifications ?? []).map((n) => n.user_id).filter(Boolean)));
    const profilesById = new Map<string, { email: string | null; prenom: string | null; nom: string | null }>();
    if (userIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from("profiles")
        .select("id, email, prenom, nom")
        .in("id", userIds);
      if (profilesError) throw new Error(profilesError.message);
      for (const profile of profiles ?? []) profilesById.set(profile.id, profile);
    }

    return (notifications ?? []).map((notification) => {
      const profile = profilesById.get(notification.user_id);
      const name = `${profile?.prenom ?? ""} ${profile?.nom ?? ""}`.trim();
      return {
        id: notification.id,
        user_id: notification.user_id,
        type: notification.type,
        titre: notification.titre,
        message: notification.message,
        link: notification.link,
        read_at: notification.read_at,
        created_at: notification.created_at,
        recipient_email: profile?.email ?? null,
        recipient_name: name || null,
      };
    });
  });

/** Crée une notification de test pour un membre — déclenche aussi le fan-out push si son navigateur est activé */
export const testPushNotificationForMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrDirection(supabase, userId);

    const { data: notificationId, error } = await (supabase as any).rpc("test_push_notification_for_user", {
      _user_id: data.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true, notificationId };
  });

/** Inviter un membre de l'équipe */
export const inviteTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        email: z.string().trim().email().max(255),
        prenom: z.string().trim().max(100).optional(),
        nom: z.string().trim().max(100).optional(),
        role: z.enum(STAFF_ROLES),
        pole_ids: z.array(z.string().uuid()).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminOrDirection(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();

    // Chercher un profil existant
    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    let targetId: string | null = existing?.id ?? null;
    let invited = false;

    if (!targetId) {
      const { data: inv, error: invErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { prenom: data.prenom ?? "", nom: data.nom ?? "" },
      });
      if (invErr) throw new Error(invErr.message);
      targetId = inv.user?.id ?? null;
      invited = true;
      if (!targetId) throw new Error("L'invitation a échoué");
      await supabaseAdmin
        .from("profiles")
        .update({ prenom: data.prenom ?? "", nom: data.nom ?? "", email })
        .eq("id", targetId);
    }

    // Retirer role client (le trigger le fait aussi, ceinture + bretelles)
    await supabaseAdmin.from("user_roles").delete().eq("user_id", targetId).eq("role", "client");

    // Ajouter le rôle demandé
    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: targetId, role: data.role }, { onConflict: "user_id,role" });
    if (rErr) throw new Error(rErr.message);

    // Pôles — seuls manager/consultant sont membres de pôles
    if (data.pole_ids && data.pole_ids.length > 0 && (data.role === "manager" || data.role === "consultant")) {
      const poleRole: "manager" | "consultant" = data.role;
      const rows = data.pole_ids.map((pole_id) => ({
        pole_id,
        user_id: targetId!,
        role: poleRole,
      }));
      const { error: pErr } = await supabaseAdmin
        .from("pole_members")
        .upsert(rows, { onConflict: "pole_id,user_id" });
      if (pErr) throw new Error(pErr.message);
    }

    return { ok: true, user_id: targetId, invited };
  });

/** Modifier le rôle principal d'un membre (staff uniquement) */
export const updateTeamRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(STAFF_ROLES),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    await assertAdmin(supabase, callerId);
    if (data.userId === callerId && data.role !== "admin") {
      throw new Error("Vous ne pouvez pas retirer votre propre rôle administrateur");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Supprime les rôles staff existants + client
    await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .in("role", ["client", ...STAFF_ROLES]);
    // Ajoute le nouveau rôle
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.userId, role: data.role });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      user_id: callerId,
      action: "team.role_changed",
      entity_type: "user",
      entity_id: data.userId,
      severity: "warning",
      metadata: { new_role: data.role },
    });

    return { ok: true };
  });

/** Désactiver un membre */
export const disableTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ userId: z.string().uuid(), reason: z.string().trim().max(500).optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("disable_team_member", {
      _user_id: data.userId,
      _reason: data.reason ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Réactiver un membre */
export const enableTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("enable_team_member", { _user_id: data.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Envoyer un email de réinitialisation de mot de passe */
export const resetTeamMemberPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    await assertAdminOrDirection(supabase, callerId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", data.userId)
      .maybeSingle();
    if (!profile?.email) throw new Error("Email introuvable");

    const { error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: profile.email,
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      user_id: callerId,
      action: "team.password_reset",
      entity_type: "user",
      entity_id: data.userId,
      severity: "info",
      metadata: {},
    });

    return { ok: true };
  });

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function callerIsAdminOrDirection(supabase: any, callerId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", callerId);
  return {
    isAdmin: !!roles?.some((r: any) => r.role === "admin"),
    isDirection: !!roles?.some((r: any) => r.role === "direction"),
    isStaff: !!roles?.some((r: any) => ["admin", "direction", "manager", "consultant"].includes(r.role)),
  };
}

/**
 * Archive un client (admin/direction) — remplace la suppression.
 * Utilise la fonction SQL public.archive_client qui verrouille les sessions et journalise.
 */
export const archiveClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ userId: z.string().uuid(), reason: z.string().trim().max(500).optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    const perms = await callerIsAdminOrDirection(supabase, callerId);
    if (!perms.isAdmin && !perms.isDirection) throw new Error("Réservé à la direction / administration");
    if (data.userId === callerId) throw new Error("Vous ne pouvez pas archiver votre propre compte");
    const { error } = await supabase.rpc("archive_client", { _user_id: data.userId, _reason: data.reason });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unarchiveClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.rpc("unarchive_client", { _user_id: data.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Vérifie qu'un membre de l'agence a bien accès à un client dans son périmètre de pôle.
 * Utilisé par les routes admin.clients.$id et admin.messages.$clientId comme garde-fou serveur.
 */
export const assertClientAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ clientId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    const { data: allowed, error } = await supabase.rpc("client_in_scope", {
      _staff: callerId,
      _client: data.clientId,
    });
    if (error) throw new Error(error.message);
    if (!allowed) throw new Error("Accès refusé : ce client n'est pas dans vos pôles");
    return { ok: true };
  });

export const updateClientProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        userId: z.string().uuid(),
        prenom: z.string().trim().max(100).optional(),
        nom: z.string().trim().max(100).optional(),
        email: z.string().email().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    const perms = await callerIsAdminOrDirection(supabase, callerId);
    if (!perms.isAdmin) throw new Error("Réservé aux administrateurs");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: { prenom?: string; nom?: string; email?: string } = {};
    if (data.prenom !== undefined) patch.prenom = data.prenom;
    if (data.nom !== undefined) patch.nom = data.nom;
    if (data.email !== undefined) patch.email = data.email;

    if (Object.keys(patch).length > 0) {
      const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", data.userId);
      if (error) throw new Error(error.message);
    }
    if (data.email) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
        email: data.email,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const inviteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        email: z.string().trim().email().max(255),
        prenom: z.string().trim().max(100).optional(),
        nom: z.string().trim().max(100).optional(),
        dossier_id: z.string().uuid().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    const perms = await callerIsAdminOrDirection(supabase, callerId);
    if (!perms.isAdmin && !perms.isDirection) throw new Error("Réservé à la direction / administration");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();

    let userId: string | null = null;
    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existing?.id) userId = existing.id;

    let invited = false;
    if (!userId) {
      const { data: inv, error: invErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { prenom: data.prenom ?? "", nom: data.nom ?? "" },
      });
      if (invErr) throw new Error(invErr.message);
      userId = inv.user?.id ?? null;
      invited = true;
      if (!userId) throw new Error("L'invitation a échoué (aucun identifiant utilisateur retourné)");
      await supabaseAdmin
        .from("profiles")
        .update({
          prenom: data.prenom ?? "",
          nom: data.nom ?? "",
          email,
        })
        .eq("id", userId);
    }

    if (data.dossier_id) {
      const { error: dErr } = await supabaseAdmin
        .from("dossiers")
        .update({ client_id: userId })
        .eq("id", data.dossier_id);
      if (dErr) throw new Error(dErr.message);
    }

    return { ok: true, user_id: userId, invited };
  });

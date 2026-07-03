import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    const isAdmin = roles?.some((r: any) => r.role === "admin");
    if (!isAdmin) throw new Error("Réservé aux administrateurs");
    if (data.userId === callerId) throw new Error("Vous ne pouvez pas supprimer votre propre compte");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
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
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    const isAdmin = roles?.some((r: any) => r.role === "admin");
    if (!isAdmin) throw new Error("Réservé aux administrateurs");

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
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    const staff = roles?.some((r: any) => ["admin", "direction"].includes(r.role));
    if (!staff) throw new Error("Réservé à la direction / administration");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();

    // 1) Chercher un profil existant par email
    let userId: string | null = null;
    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existing?.id) userId = existing.id;

    let invited = false;
    if (!userId) {
      // 2) Envoyer une invitation e-mail Supabase
      const { data: inv, error: invErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { prenom: data.prenom ?? "", nom: data.nom ?? "" },
      });
      if (invErr) throw new Error(invErr.message);
      userId = inv.user?.id ?? null;
      invited = true;
      if (!userId) throw new Error("L'invitation a échoué (aucun identifiant utilisateur retourné)");
      // Le trigger handle_new_user crée le profil ; on complète les champs saisis.
      await supabaseAdmin
        .from("profiles")
        .update({
          prenom: data.prenom ?? "",
          nom: data.nom ?? "",
          email,
        })
        .eq("id", userId);
    }

    // 3) Rattacher au dossier si demandé
    if (data.dossier_id) {
      const { error: dErr } = await supabaseAdmin
        .from("dossiers")
        .update({ client_id: userId })
        .eq("id", data.dossier_id);
      if (dErr) throw new Error(dErr.message);
    }

    return { ok: true, user_id: userId, invited };
  });


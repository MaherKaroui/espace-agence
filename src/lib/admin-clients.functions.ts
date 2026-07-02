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
    const patch: Record<string, unknown> = {};
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

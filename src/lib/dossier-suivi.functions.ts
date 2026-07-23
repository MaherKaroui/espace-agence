import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const STAFF_ROLES = ["admin", "direction", "manager", "consultant"] as const;

async function isStaff(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).some((r: any) => (STAFF_ROLES as readonly string[]).includes(r.role));
}

/**
 * Returns assignable staff members for a given dossier:
 * pole members + admins + direction. Staff-only.
 */
export const listAssignableStaffForDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ dossierId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!(await isStaff(supabase, userId))) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: dossier } = await supabaseAdmin
      .from("dossiers").select("pole_id").eq("id", data.dossierId).maybeSingle();

    let memberIds: string[] = [];
    if (dossier?.pole_id) {
      const { data: members } = await supabaseAdmin
        .from("pole_members").select("user_id").eq("pole_id", dossier.pole_id);
      memberIds = (members ?? []).map((m: any) => m.user_id);
    }

    const { data: adminRoles } = await supabaseAdmin
      .from("user_roles").select("user_id").in("role", ["admin", "direction"] as any);
    const adminIds = (adminRoles ?? []).map((r: any) => r.user_id);

    const allIds = Array.from(new Set([...memberIds, ...adminIds]));
    if (allIds.length === 0) return [] as Array<{ id: string; nom: string; email: string }>;

    const { data: profs } = await supabaseAdmin
      .from("profiles").select("id, prenom, nom, email").in("id", allIds);

    return (profs ?? []).map((p: any) => ({
      id: p.id,
      nom: `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || "Sans nom",
      email: p.email ?? "",
    })).sort((a, b) => a.nom.localeCompare(b.nom));
  });

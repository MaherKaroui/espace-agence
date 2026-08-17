import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { syncExternalConversationMember } from "./dossier-assignments.server";

export type AssignmentRole = "auditeur" | "certificateur" | "juridique";

export type ExternalIntervenant = {
  assignment_id: string;
  user_id: string;
  role: AssignmentRole;
  email: string;
  prenom: string | null;
  nom: string | null;
  assigned_at: string;
  assigned_by: string | null;
  active?: boolean;
  revoked_at?: string | null;
  assigned_by_name?: string | null;
};

async function assertStaffOnDossier(supabase: any, userId: string, dossierId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const staff = !!roles?.some((r: any) => ["admin", "direction", "manager", "consultant"].includes(r.role));
  if (!staff) throw new Error("Réservé au personnel agence");
  // RLS on dossier_assignments handles per-pole scoping; still verify visibility
  const { data: d } = await supabase.from("dossiers").select("id").eq("id", dossierId).maybeSingle();
  if (!d) throw new Error("Dossier introuvable ou hors de votre périmètre");
}

/** Liste les intervenants externes (auditeurs/certificateurs) affectés à un dossier */
export const listDossierIntervenants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { dossierId: string }) => z.object({ dossierId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<ExternalIntervenant[]> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("dossier_assignments")
      .select("id, user_id, role, assigned_at, assigned_by")
      .eq("dossier_id", data.dossierId)
      .eq("active", true)
      .in("role", ["auditeur", "certificateur"])
      .order("assigned_at", { ascending: false });
    if (error) throw new Error(error.message);
    const userIds = [...new Set((rows ?? []).map((r) => r.user_id))];
    if (userIds.length === 0) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, email, prenom, nom")
      .in("id", userIds);
    const byId = new Map((profs ?? []).map((p) => [p.id, p]));
    return (rows ?? []).map((r) => {
      const p = byId.get(r.user_id) as any;
      return {
        assignment_id: r.id,
        user_id: r.user_id,
        role: r.role as AssignmentRole,
        email: p?.email ?? "",
        prenom: p?.prenom ?? null,
        nom: p?.nom ?? null,
        assigned_at: r.assigned_at,
        assigned_by: r.assigned_by,
      };
    });
  });

/** Liste les utilisateurs disponibles ayant le rôle auditeur ou certificateur */
export const listExternalUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { role: AssignmentRole }) =>
    z.object({ role: z.enum(["auditeur", "certificateur", "juridique"]) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: myRoles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isStaff = !!myRoles?.some((r: any) => ["admin", "direction", "manager", "consultant"].includes(r.role));
    if (!isStaff) throw new Error("Réservé au personnel agence");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let ids: string[] = [];
    if (data.role === "juridique") {
      // Membres du pôle Juridique (salariés juridiques)
      const { data: pole } = await supabaseAdmin.from("poles").select("id").eq("code", "juridique").maybeSingle();
      if (!pole) return [] as { id: string; email: string; prenom: string | null; nom: string | null }[];
      const { data: members } = await supabaseAdmin
        .from("pole_members")
        .select("user_id")
        .eq("pole_id", pole.id);
      ids = [...new Set((members ?? []).map((m) => m.user_id))];
    } else {
      const { data: rolesRows } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("role", data.role);
      ids = [...new Set((rolesRows ?? []).map((r) => r.user_id))];
    }
    if (ids.length === 0) return [] as { id: string; email: string; prenom: string | null; nom: string | null }[];
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, email, prenom, nom")
      .in("id", ids)
      .is("archived_at", null)
      .order("nom", { ascending: true });
    return (profs ?? []) as { id: string; email: string; prenom: string | null; nom: string | null }[];
  });

/** Affecte un auditeur ou certificateur à un dossier */
export const assignIntervenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { dossierId: string; userId: string; role: AssignmentRole }) =>
    z.object({
      dossierId: z.string().uuid(),
      userId: z.string().uuid(),
      role: z.enum(["auditeur", "certificateur", "juridique"]),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStaffOnDossier(supabase, userId, data.dossierId);
    // Vérifie que la cible est bien éligible
    if (data.role === "juridique") {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: pole } = await supabaseAdmin.from("poles").select("id").eq("code", "juridique").maybeSingle();
      const { data: pm } = pole
        ? await supabaseAdmin.from("pole_members").select("user_id").eq("pole_id", pole.id).eq("user_id", data.userId).maybeSingle()
        : { data: null as any };
      if (!pm) throw new Error("Cet utilisateur n'appartient pas au pôle Juridique");
    } else {
    const { data: hasRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId)
      .eq("role", data.role)
      .maybeSingle();
    if (!hasRole) throw new Error(`Cet utilisateur n'a pas le rôle ${data.role}`);
    }

    // Réactive une éventuelle affectation existante
    const { data: existing } = await supabase
      .from("dossier_assignments")
      .select("id, active")
      .eq("dossier_id", data.dossierId)
      .eq("user_id", data.userId)
      .eq("role", data.role)
      .maybeSingle();

    if (existing) {
      if (!existing.active) {
        const { error } = await supabase
          .from("dossier_assignments")
          .update({ active: true, revoked_at: null, assigned_by: userId, assigned_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
      }
      if (data.role !== "juridique") await syncExternalConversationMember(data.dossierId, data.userId, true);
      return { ok: true, id: existing.id };
    }

    const { data: inserted, error } = await supabase
      .from("dossier_assignments")
      .insert({
        dossier_id: data.dossierId,
        user_id: data.userId,
        role: data.role,
        assigned_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (data.role !== "juridique") await syncExternalConversationMember(data.dossierId, data.userId, true);
    return { ok: true, id: inserted.id };
  });

/** Révoque une affectation */
export const revokeIntervenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { assignmentId: string }) =>
    z.object({ assignmentId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: a } = await supabase
      .from("dossier_assignments")
      .select("dossier_id, user_id, role")
      .eq("id", data.assignmentId)
      .maybeSingle();
    if (!a) throw new Error("Affectation introuvable");
    await assertStaffOnDossier(supabase, userId, a.dossier_id);
    const { error } = await supabase
      .from("dossier_assignments")
      .update({ active: false, revoked_at: new Date().toISOString() })
      .eq("id", data.assignmentId);
    if (error) throw new Error(error.message);
    if ((a as any).role !== "juridique") await syncExternalConversationMember(a.dossier_id, a.user_id, false);
    return { ok: true };
  });

/** Liste les dossiers auxquels l'utilisateur courant est affecté (rôle externe) */
export const listMyAssignedDossiers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: assignments, error } = await supabase
      .from("dossier_assignments")
      .select("id, dossier_id, role, assigned_at")
      .eq("user_id", userId)
      .eq("active", true);
    if (error) throw new Error(error.message);
    const dossierIds = [...new Set((assignments ?? []).map((a) => a.dossier_id))];
    if (dossierIds.length === 0) return [];
    const { data: dossiers } = await supabase
      .from("dossiers")
      .select("id, titre, categorie, statut, avancement, organisme_nom, updated_at")
      .in("id", dossierIds);
    const byDossier = new Map(
      (dossiers ?? []).map((d) => [d.id, d]),
    );
    return (assignments ?? []).map((a) => ({
      assignment_id: a.id,
      role: a.role as AssignmentRole,
      assigned_at: a.assigned_at,
      dossier: byDossier.get(a.dossier_id) ?? null,
    })).filter((r) => r.dossier);
  });


/** Liste les assignations juridiques d'un dossier (actives + historique) */
export const listJuridiqueAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { dossierId: string }) => z.object({ dossierId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<ExternalIntervenant[]> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("dossier_assignments")
      .select("id, user_id, role, assigned_at, assigned_by, active, revoked_at")
      .eq("dossier_id", data.dossierId)
      .eq("role", "juridique")
      .order("assigned_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = [...new Set([
      ...(rows ?? []).map((r) => r.user_id),
      ...(rows ?? []).map((r: any) => r.assigned_by).filter(Boolean),
    ])] as string[];
    if (ids.length === 0) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, email, prenom, nom")
      .in("id", ids);
    const byId = new Map((profs ?? []).map((p: any) => [p.id, p]));
    const nameOf = (id: string | null) => {
      if (!id) return null;
      const p: any = byId.get(id);
      if (!p) return null;
      return `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || null;
    };
    return (rows ?? []).map((r: any) => {
      const p: any = byId.get(r.user_id);
      return {
        assignment_id: r.id,
        user_id: r.user_id,
        role: "juridique" as AssignmentRole,
        email: p?.email ?? "",
        prenom: p?.prenom ?? null,
        nom: p?.nom ?? null,
        assigned_at: r.assigned_at,
        assigned_by: r.assigned_by,
        active: r.active,
        revoked_at: r.revoked_at,
        assigned_by_name: nameOf(r.assigned_by),
      };
    });
  });

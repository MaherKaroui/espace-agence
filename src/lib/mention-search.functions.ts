import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Recherche pour l'autocomplete de mentions.
 * - "@" -> retourne les membres autorisés (mêmes règles que openContextConversation)
 * - "#client" / "#dossier" / "#tache" / "#pole" -> entités liées.
 *
 * Le tri est simple (matching commence par). Limité à 8 résultats.
 */
export const searchMentionCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        kind: z.enum(["user", "client", "dossier", "task", "pole"]),
        query: z.string().max(80),
        conversationId: z.string().uuid().optional(),
        scopeClientId: z.string().uuid().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const q = data.query.trim();
    const like = `%${q}%`;

    // Vérifie rôle staff
    const { data: rolesRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const rolesArr = ((rolesRow ?? []) as any[]).map((r) => r.role);
    const isStaff = rolesArr.some((r) =>
      ["admin", "direction", "manager", "consultant"].includes(r),
    );
    if (!isStaff) throw new Error("Réservé aux membres de l'agence");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.kind === "user") {
      // Membres de la conversation en priorité, sinon tous les membres autorisés
      let ids: string[] = [];
      if (data.conversationId) {
        const { data: mems } = await supabaseAdmin
          .from("internal_conversation_members")
          .select("user_id")
          .eq("conversation_id", data.conversationId);
        ids = ((mems ?? []) as any[]).map((r) => r.user_id);
      }
      const query = supabaseAdmin.from("profiles").select("id, prenom, nom, email").limit(8);
      let rows: any[] = [];
      if (ids.length > 0) {
        const { data: profs } = await query.in("id", ids);
        rows = (profs ?? []) as any[];
      } else {
        const { data: profs } = await query.or(
          `prenom.ilike.${like},nom.ilike.${like},email.ilike.${like}`,
        );
        rows = (profs ?? []) as any[];
      }
      if (q) {
        rows = rows.filter((p) =>
          `${p.prenom ?? ""} ${p.nom ?? ""} ${p.email ?? ""}`.toLowerCase().includes(q.toLowerCase()),
        );
      }
      return rows.slice(0, 8).map((p: any) => ({
        id: p.id,
        label: `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || "Membre",
        sublabel: p.email ?? "",
      }));
    }

    if (data.kind === "client") {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, prenom, nom, email")
        .or(`prenom.ilike.${like},nom.ilike.${like},email.ilike.${like}`)
        .limit(8);
      return ((profs ?? []) as any[]).map((p) => ({
        id: p.id,
        label: `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || "Client",
        sublabel: p.email ?? "",
      }));
    }

    if (data.kind === "dossier") {
      let qd = supabaseAdmin
        .from("dossiers")
        .select("id, titre, statut, client_id")
        .limit(8);
      if (data.scopeClientId) qd = qd.eq("client_id", data.scopeClientId);
      if (q) qd = qd.ilike("titre", like);
      const { data: rows } = await qd;
      return ((rows ?? []) as any[]).map((d) => ({
        id: d.id,
        label: d.titre,
        sublabel: d.statut ?? "",
      }));
    }

    if (data.kind === "task") {
      let qt = supabaseAdmin
        .from("agency_tasks")
        .select("id, title, statut, client_id")
        .limit(8);
      if (data.scopeClientId) qt = qt.eq("client_id", data.scopeClientId);
      if (q) qt = qt.ilike("title", like);
      const { data: rows } = await qt;
      return ((rows ?? []) as any[]).map((t) => ({
        id: t.id,
        label: t.title,
        sublabel: t.statut ?? "",
      }));
    }

    if (data.kind === "pole") {
      const { data } = await supabaseAdmin
        .from("poles")
        .select("id, nom, actif")
        .ilike("nom", like)
        .limit(8);
      return ((data ?? []) as any[]).map((p) => ({
        id: p.id,
        label: p.nom,
        sublabel: p.actif ? "actif" : "inactif",
      }));
    }

    return [];
  });

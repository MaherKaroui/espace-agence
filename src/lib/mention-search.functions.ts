import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Recherche pour l'autocomplete de mentions — TOUJOURS scoping-first.
 *
 * Règles strictes :
 * - `@` (user) : renvoie uniquement les participants du contexte fourni
 *   (`conversationId` groupe/interne OU `scopeClientId` conv 1‑à‑1).
 *   Sans contexte → aucun résultat (pas de recherche globale).
 * - `#dossier` / `#task` : uniquement les dossiers/tâches d'un client donné
 *   via `scopeClientId`. Sans scope → aucun résultat.
 * - `#client` / `#pole` : réservés à admin/direction, filtre limité au périmètre
 *   staff, sinon vide.
 *
 * L'appelant doit être membre de l'agence (staff).
 * Limité à 8 résultats.
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
    const filterByQuery = (rows: any[], fields: string[]) =>
      q
        ? rows.filter((r) =>
            fields
              .map((f) => `${r[f] ?? ""}`)
              .join(" ")
              .toLowerCase()
              .includes(q.toLowerCase()),
          )
        : rows;

    // Rôles de l'appelant
    const { data: rolesRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const rolesArr = ((rolesRow ?? []) as any[]).map((r) => r.role);
    const isStaff = rolesArr.some((r) =>
      ["admin", "direction", "manager", "consultant"].includes(r),
    );
    if (!isStaff) throw new Error("Réservé aux membres de l'agence");
    const isAdminOrDirection =
      rolesArr.includes("admin") || rolesArr.includes("direction");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // ─── @ mention : participants uniquement ─────────────────────────────
    if (data.kind === "user") {
      let ids: string[] = [];

      if (data.conversationId) {
        // Essaye d'abord les groupes internes, puis les groupes client
        const [internal, group] = await Promise.all([
          supabaseAdmin
            .from("internal_conversation_members")
            .select("user_id")
            .eq("conversation_id", data.conversationId),
          supabaseAdmin
            .from("conversation_members")
            .select("user_id")
            .eq("conversation_id", data.conversationId),
        ]);
        const set = new Set<string>();
        ((internal.data ?? []) as any[]).forEach((r) => set.add(r.user_id));
        ((group.data ?? []) as any[]).forEach((r) => set.add(r.user_id));
        ids = Array.from(set);
      } else if (data.scopeClientId) {
        // Conversation 1‑à‑1 client/agence : client + admin/direction
        const { data: staff } = await supabaseAdmin
          .from("user_roles")
          .select("user_id")
          .in("role", ["admin", "direction"]);
        const set = new Set<string>(
          ((staff ?? []) as any[]).map((r) => r.user_id),
        );
        set.add(data.scopeClientId);
        ids = Array.from(set);
      } else {
        // Pas de contexte → refuse toute recherche globale
        return [];
      }

      if (ids.length === 0) return [];
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, prenom, nom, email")
        .in("id", ids);
      const rows = filterByQuery((profs ?? []) as any[], ["prenom", "nom", "email"]);
      return rows.slice(0, 8).map((p: any) => ({
        id: p.id,
        label: `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || "Membre",
        sublabel: p.email ?? "",
      }));
    }

    // ─── #dossier : uniquement pour un client donné ──────────────────────
    if (data.kind === "dossier") {
      if (!data.scopeClientId) return [];
      let qd = supabaseAdmin
        .from("dossiers")
        .select("id, titre, statut, client_id")
        .eq("client_id", data.scopeClientId)
        .limit(8);
      if (q) qd = qd.ilike("titre", like);
      const { data: rows } = await qd;
      return ((rows ?? []) as any[]).map((d) => ({
        id: d.id,
        label: d.titre,
        sublabel: d.statut ?? "",
      }));
    }

    // ─── #task : uniquement pour un client donné ─────────────────────────
    if (data.kind === "task") {
      if (!data.scopeClientId) return [];
      let qt = supabaseAdmin
        .from("agency_tasks")
        .select("id, title, statut, client_id")
        .eq("client_id", data.scopeClientId)
        .limit(8);
      if (q) qt = qt.ilike("title", like);
      const { data: rows } = await qt;
      return ((rows ?? []) as any[]).map((t) => ({
        id: t.id,
        label: t.title,
        sublabel: t.statut ?? "",
      }));
    }

    // ─── #client : admin/direction seulement ─────────────────────────────
    if (data.kind === "client") {
      if (!isAdminOrDirection) return [];
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

    // ─── #pole : admin/direction seulement ───────────────────────────────
    if (data.kind === "pole") {
      if (!isAdminOrDirection) return [];
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

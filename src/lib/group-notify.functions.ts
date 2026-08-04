import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Résout les destinataires e-mail d'un groupe (groupes clients `conversations`
 * ou groupes/canaux internes `internal_conversations`).
 *
 * Sécurité : l'appelant doit être membre de la conversation (vérifié via RLS)
 * avant que les e-mails ne soient résolus côté service.
 */
export const getGroupRecipients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        kind: z.enum(["client", "internal"]),
        conversationId: z.string().uuid(),
        /** Restreindre aux membres donnés (ex. nouveaux membres ajoutés). */
        userIds: z.array(z.string().uuid()).max(200).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const memberTable = data.kind === "client" ? "conversation_members" : "internal_conversation_members";
    const convTable = data.kind === "client" ? "conversations" : "internal_conversations";

    // Autorisation : l'appelant doit être membre (RLS applique déjà la visibilité)
    const { data: me } = await supabase
      .from(memberTable as any)
      .select("user_id")
      .eq("conversation_id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!me) return { titre: null, emails: [] as string[], senderName: null as string | null };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: conv } = await supabaseAdmin
      .from(convTable as any)
      .select("titre")
      .eq("id", data.conversationId)
      .maybeSingle();

    let ids: string[];
    if (data.userIds?.length) {
      ids = data.userIds;
    } else {
      const { data: mems } = await supabaseAdmin
        .from(memberTable as any)
        .select("user_id")
        .eq("conversation_id", data.conversationId);
      ids = ((mems ?? []) as any[]).map((m) => m.user_id);
    }
    ids = Array.from(new Set(ids)).filter((id) => id && id !== userId);
    if (ids.length === 0) return { titre: (conv as any)?.titre ?? null, emails: [], senderName: null };

    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, email, prenom, nom, archived_at")
      .in("id", ids);

    const emails = Array.from(
      new Set(
        ((profs ?? []) as any[])
          .filter((p) => !p.archived_at && p.email)
          .map((p) => p.email as string),
      ),
    );

    const { data: meProf } = await supabaseAdmin
      .from("profiles")
      .select("prenom, nom, email")
      .eq("id", userId)
      .maybeSingle();
    const senderName =
      `${(meProf as any)?.prenom ?? ""} ${(meProf as any)?.nom ?? ""}`.trim() ||
      (meProf as any)?.email ||
      null;

    return { titre: (conv as any)?.titre ?? null, emails, senderName };
  });

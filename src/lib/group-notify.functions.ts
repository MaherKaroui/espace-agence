import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

function linkFor(kind: "client" | "internal", conversationId: string) {
  return kind === "client"
    ? `/messages/groupes/${conversationId}`
    : `/admin/internal-messages/${conversationId}`;
}

/**
 * Prévient par e-mail les membres d'un groupe (groupes clients `conversations`
 * ou groupes/canaux internes `internal_conversations`) : nouveau message ou
 * ajout de membres.
 *
 * Sécurité : l'appelant doit être membre de la conversation (vérifié via RLS),
 * les `userIds` sont restreints aux membres réels, les comptes archivés sont
 * exclus, et aucune adresse n'est renvoyée au navigateur.
 */
export const notifyGroupFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .discriminatedUnion("event", [
        z.object({
          event: z.literal("new_message"),
          kind: z.enum(["client", "internal"]),
          conversationId: z.string().uuid(),
          extrait: z.string().max(500).optional(),
        }),
        z.object({
          event: z.literal("members_added"),
          kind: z.enum(["client", "internal"]),
          conversationId: z.string().uuid(),
          userIds: z.array(z.string().uuid()).max(200),
          groupTitreFallback: z.string().max(200).optional(),
        }),
      ])
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
    if (!me) return { ok: true as const, sent: 0 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendAppEmail } = await import("./email/send.server");
    const { APP_URL } = await import("./app-url");

    const { data: conv } = await supabaseAdmin
      .from(convTable as any)
      .select("titre")
      .eq("id", data.conversationId)
      .maybeSingle();

    let memsQuery = supabaseAdmin
      .from(memberTable as any)
      .select("user_id")
      .eq("conversation_id", data.conversationId);
    // Restreindre aux membres réels parmi les userIds fournis (nouveaux membres)
    if (data.event === "members_added") memsQuery = memsQuery.in("user_id", data.userIds);
    const { data: mems } = await memsQuery;
    let ids: string[] = ((mems ?? []) as any[]).map((m) => m.user_id);
    ids = Array.from(new Set(ids)).filter((id) => id && id !== userId);
    if (ids.length === 0) return { ok: true as const, sent: 0 };

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
    if (emails.length === 0) return { ok: true as const, sent: 0 };

    const { data: meProf } = await supabaseAdmin
      .from("profiles")
      .select("prenom, nom, email")
      .eq("id", userId)
      .maybeSingle();
    const senderName =
      `${(meProf as any)?.prenom ?? ""} ${(meProf as any)?.nom ?? ""}`.trim() ||
      (meProf as any)?.email ||
      null;

    const titre: string | null = (conv as any)?.titre ?? null;
    const link = linkFor(data.kind, data.conversationId);
    const bucket = Math.floor(Date.now() / (10 * 60 * 1000));

    const results = await Promise.allSettled(
      emails.map((email) =>
        data.event === "members_added"
          ? sendAppEmail({
              templateName: "group-invitation",
              recipientEmail: email,
              idempotencyKey: `group-invite-${data.conversationId}-${email}`,
              templateData: {
                groupTitre: titre ?? data.groupTitreFallback,
                invitedBy: senderName ?? undefined,
                link,
                appUrl: APP_URL,
              },
            })
          : sendAppEmail({
              templateName: "group-nouveau-message",
              recipientEmail: email,
              idempotencyKey: `group-msg-${data.conversationId}-${email}-${bucket}`,
              templateData: {
                groupTitre: titre ?? undefined,
                senderName: senderName ?? undefined,
                extrait: data.extrait?.slice(0, 140),
                link,
                appUrl: APP_URL,
              },
            }),
      ),
    );
    const sent = results.filter((r) => r.status === "fulfilled" && r.value.success === true).length;
    return { ok: true as const, sent };
  });

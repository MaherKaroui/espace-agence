import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AttachmentSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  mime: z.string().nullable().optional(),
});

/**
 * Diffusion d'un message de l'agence vers plusieurs clients (ou tous).
 * - Publie le message dans la messagerie de chaque client (avec pièces jointes),
 *   ce qui déclenche les notifications habituelles (cloche + push).
 * - Envoie à chaque client un e-mail individuel reprenant le message et des
 *   liens sécurisés vers les pièces jointes (les fichiers ne sont pas joints).
 * Réservé à l'administration / direction.
 */
export const broadcastToClients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        titre: z.string().trim().min(1).max(160),
        message: z.string().trim().min(1).max(5000),
        clientIds: z.array(z.string().uuid()).max(2000).optional(),
        allClients: z.boolean().optional(),
        attachments: z.array(AttachmentSchema).max(10).optional(),
        sendEmail: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;

    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", callerId);
    const isAllowed = (roles ?? []).some((r: any) => ["admin", "direction"].includes(r.role));
    if (!isAllowed) throw new Error("Réservé à l'administration / direction");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendAppEmail } = await import("./email/send.server");
    const { APP_URL } = await import("./app-url");

    // Comptes internes exclus de la diffusion clients
    const { data: staffRoles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "direction", "manager", "consultant"]);
    const staffIds = new Set(((staffRoles ?? []) as any[]).map((r) => r.user_id as string));

    let query = supabaseAdmin.from("profiles").select("id, email, prenom").is("archived_at", null);
    if (!data.allClients) {
      const ids = (data.clientIds ?? []).filter((id) => !staffIds.has(id));
      if (ids.length === 0) throw new Error("Aucun client sélectionné");
      query = query.in("id", ids);
    }
    const { data: profiles, error: profErr } = await query;
    if (profErr) throw new Error(profErr.message);

    const targets = ((profiles ?? []) as any[]).filter((p) => !staffIds.has(p.id));
    if (targets.length === 0) throw new Error("Aucun destinataire trouvé");

    // Liens sécurisés (7 jours) vers les pièces jointes, pour l'e-mail
    const attachments = data.attachments ?? [];
    const pieces: { name: string; url: string }[] = [];
    if (attachments.length > 0) {
      const { data: signed } = await supabaseAdmin.storage
        .from("chat-files")
        .createSignedUrls(attachments.map((a) => a.path), 60 * 60 * 24 * 7);
      (signed ?? []).forEach((s: any, i: number) => {
        if (s?.signedUrl) pieces.push({ name: attachments[i]!.name, url: s.signedUrl });
      });
    }

    const stamp = Date.now();
    let messagesEnvoyes = 0;
    let emailsEnvoyes = 0;
    const erreurs: string[] = [];

    for (const target of targets) {
      // 1) Message dans la messagerie du client (déclenche cloche + push)
      const rows = attachments.length > 0
        ? attachments.map((a, i) => ({
            client_id: target.id,
            sender_id: callerId,
            from_agence: true,
            content: i === 0 ? `${data.titre}\n\n${data.message}` : null,
            attachment_path: a.path,
            attachment_name: a.name,
            attachment_mime: a.mime ?? null,
          }))
        : [
            {
              client_id: target.id,
              sender_id: callerId,
              from_agence: true,
              content: `${data.titre}\n\n${data.message}`,
              attachment_path: null,
              attachment_name: null,
              attachment_mime: null,
            },
          ];

      const { error: msgErr } = await supabaseAdmin.from("messages").insert(rows as any);
      if (msgErr) {
        erreurs.push(msgErr.message);
        continue;
      }
      messagesEnvoyes += 1;

      // 2) E-mail individuel (liens vers les pièces jointes)
      if (data.sendEmail !== false && target.email) {
        const res = await sendAppEmail({
          templateName: "client-annonce",
          recipientEmail: target.email,
          idempotencyKey: `diffusion-${stamp}-${target.id}`,
          templateData: {
            prenom: target.prenom || "",
            titre: data.titre,
            message: data.message,
            pieces,
            appUrl: APP_URL,
          },
        });
        if (res.success) emailsEnvoyes += 1;
      }
    }

    await supabase.rpc("log_event", {
      _action: "diffusion.clients",
      _entity_type: "message",
      _entity_id: callerId,
      _severity: "info",
      _metadata: {
        destinataires: targets.length,
        messages: messagesEnvoyes,
        emails: emailsEnvoyes,
        pieces: attachments.length,
      },
    });

    return { destinataires: targets.length, messagesEnvoyes, emailsEnvoyes, erreurs: erreurs.slice(0, 5) };
  });

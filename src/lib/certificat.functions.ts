import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { historyLine, parseCertHistory } from "./certificat-mails";

/**
 * Envoie une demande ou une relance de certificat Qualiopi au certificateur,
 * depuis une ligne du calendrier Qualiopi.
 * - Un e-mail par destinataire, réponse adressée au collaborateur qui envoie.
 * - Trace l'envoi dans « Notes de suivi » (visible dans le calendrier et l'export Excel).
 * - Réservé aux lignes au statut « Certificat à récupérer ».
 * Réservé à l'équipe.
 */
export const sendCertificatMail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        eventId: z.string().uuid(),
        kind: z.enum(["demande", "relance"]),
        recipients: z.array(z.string().trim().toLowerCase().email()).min(1).max(10),
        subject: z.string().trim().min(3).max(250),
        body: z.string().trim().min(20).max(8000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isStaff = (roles ?? []).some((r: any) => ["admin", "direction", "manager", "consultant"].includes(r.role));
    if (!isStaff) throw new Error("Réservé à l'équipe");

    const { data: ev, error: evErr } = await supabase
      .from("qualiopi_calendar_events" as any)
      .select("id, organism_name, status, notes_suivi")
      .eq("id", data.eventId)
      .maybeSingle();
    if (evErr) throw new Error(evErr.message);
    if (!ev) throw new Error("Ligne du calendrier introuvable");
    const event = ev as any;
    if (event.status !== "certificat_a_recuperer") {
      throw new Error("Envoi réservé aux OF au statut « Certificat à récupérer »");
    }

    const { data: me } = await supabase.from("profiles").select("email").eq("id", userId).maybeSingle();
    const replyTo = (me as any)?.email ?? null;

    const { sendAppEmail } = await import("./email/send.server");
    const recipients = Array.from(new Set(data.recipients));
    const history = parseCertHistory(event.notes_suivi);
    const rank = data.kind === "relance" ? history.filter((h) => h.kind === "relance").length + 1 : 0;
    const stamp = Date.now();

    const sent: string[] = [];
    const failed: { email: string; reason: string }[] = [];
    for (const email of recipients) {
      const res = await sendAppEmail({
        templateName: "certificateur-courrier",
        recipientEmail: email,
        replyTo,
        idempotencyKey: `certificat-${data.eventId}-${data.kind}-${rank}-${email}-${stamp}`,
        templateData: { subject: data.subject, body: data.body },
      });
      if (res.success) sent.push(email);
      else failed.push({ email, reason: res.reason === "send_failed" ? res.error ?? "échec d'envoi" : res.reason });
    }

    if (sent.length > 0) {
      const line = historyLine(data.kind, rank, sent);
      const notes = [event.notes_suivi?.trim(), line].filter(Boolean).join("\n");
      const { error: upErr } = await supabase
        .from("qualiopi_calendar_events" as any)
        .update({ notes_suivi: notes, updated_by: userId } as any)
        .eq("id", data.eventId);
      if (upErr) throw new Error(`E-mail envoyé mais suivi non enregistré : ${upErr.message}`);

      await supabase.rpc("log_event" as any, {
        _action: data.kind === "demande" ? "qualiopi_certificat_demande" : "qualiopi_certificat_relance",
        _entity_type: "qualiopi_calendar_events",
        _entity_id: data.eventId,
        _severity: "info",
        _metadata: { organisme: event.organism_name, rang: rank, destinataires: sent, echecs: failed },
      } as any);
    }

    return { sent, failed, rank };
  });
